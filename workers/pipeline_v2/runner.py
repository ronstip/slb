"""Pipeline runner — orchestrates the post-level DAG for a single collection.

Replaces the monolithic run_pipeline() + run_collection() with:
1. Crawl in background thread (posts enter DAG as they arrive)
2. Processing loop (moves posts through download → enrich → embed)
3. Collection gates (stats, clustering — after all posts terminal)
4. Final status (scheduling for ongoing collections)
"""

import json
import logging
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import uuid4


from config.settings import get_settings
from workers.collection.models import Post
from workers.collection.normalizer import (
    channel_to_bq_row,
    post_to_bq_row,
    post_to_engagement_row,
)
from workers.collection.wrapper import DataProviderWrapper
from workers.pipeline_v2.post_state import FAILURE_STATES, TERMINAL_STATES, PostState
from workers.pipeline_v2.state_manager import StateManager
from workers.pipeline_v2.steps import PIPELINE_STEPS, StepContext
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

PIPELINE_LOOP_TIMEOUT = 3500  # Just under Cloud Run timeout (3600s) to allow graceful cleanup
PIPELINE_LOOP_SOFT_TIMEOUT = 3000  # Self-reschedule threshold (~50 min) — leaves headroom to finish in-flight batches and enqueue a continuation


class PipelineRunner:
    """Runs the post-level DAG pipeline for a single collection."""

    def __init__(self, collection_id: str, continuation: bool = False):
        self.collection_id = collection_id
        self.continuation = continuation
        self.settings = get_settings()
        self.bq = BQClient(self.settings)
        self.fs = FirestoreClient(self.settings)
        self.gcs = GCSClient(self.settings)
        self.state_manager = StateManager(collection_id, self.settings)

        self._crawl_complete = threading.Event()
        self._crawl_error: str | None = None
        self._config: dict = {}
        self._status_doc: dict = {}
        self._custom_fields = None
        self._enrichment_context: str | None = None
        self._content_types: list[str] | None = None
        self._total_posts_collected = 0
        self._continuation_scheduled = False

    def run(self) -> None:
        """Main entry point — runs the full pipeline.

        Wraps the entire pipeline in a try/except so that any crash
        (unhandled exception, transient error, etc.) always results in
        a final status update rather than leaving the collection stuck
        at 'processing' forever.
        """
        logger.info("━━━ Pipeline V2 START %s ━━━", self.collection_id)
        pipeline_start = _time.monotonic()
        try:
            self._run_pipeline(pipeline_start)
        except Exception as e:
            elapsed = round(_time.monotonic() - pipeline_start, 1)
            logger.exception(
                "━━━ Pipeline V2 CRASHED %s after %.1fs ━━━",
                self.collection_id, elapsed,
            )
            self._set_crashed_status(str(e))

    def _get_agent_id(self) -> str | None:
        """Return the agent_id linked to this collection, if any."""
        status = self.fs.get_collection_status(self.collection_id)
        return (status or {}).get("agent_id")

    def _check_agent_completion(self) -> None:
        """Trigger agent continuation check if this collection belongs to an agent."""
        try:
            from workers.agent_continuation import check_agent_completion
            check_agent_completion(self.collection_id)
        except Exception as e:
            logger.exception("Task continuation check failed for %s", self.collection_id)
            agent_id = self._get_agent_id()
            if agent_id:
                try:
                    self.fs.add_agent_log(
                        agent_id,
                        f"Agent continuation check failed: {type(e).__name__}: {e}",
                        source="continuation",
                        level="error",
                    )
                except Exception:
                    logger.debug("Failed to log continuation error for agent %s", agent_id, exc_info=True)

    def _log_task(self, message: str, level: str = "info", metadata: dict | None = None) -> None:
        """Write to the parent agent's activity log (no-op if no agent_id)."""
        agent_id = self._get_agent_id()
        if not agent_id:
            return
        try:
            self.fs.add_agent_log(agent_id, message, source="pipeline", level=level, metadata=metadata)
        except Exception:
            logger.debug("Failed to write agent log for collection %s", self.collection_id, exc_info=True)

    def _acquire_pipeline_lock(self) -> bool:
        """Check if this pipeline should run, preventing duplicate executions.

        Returns True if this instance should proceed, False if it should abort.
        Prevents the Cloud Tasks retry loop that caused 17x duplicate runs in production.

        Continuation runs (enqueued by this runner when it approaches the Cloud
        Run timeout) bypass the active-run guard — the previous instance has
        already exited and cleared its run_id before dispatching the task.
        """
        TERMINAL_STATUSES = {"success", "failed"}
        ACTIVE_STATUSES = {"running"}
        STALE_THRESHOLD_SEC = 300  # 5 minutes

        # Read raw Firestore doc (bypass status normalization that maps pending→running)
        raw_doc = self.fs._db.collection("collection_status").document(self.collection_id).get()
        if not raw_doc.exists:
            logger.warning("Pipeline lock: no status doc for %s — proceeding", self.collection_id)
            return True

        status_doc = raw_doc.to_dict()
        current_status = status_doc.get("status", "")

        # Already finished — don't re-run (even for continuations; a successful
        # prior run means nothing is left to do)
        if current_status in TERMINAL_STATUSES:
            logger.info(
                "Pipeline lock: %s already in terminal state '%s' — skipping duplicate run",
                self.collection_id, current_status,
            )
            return False

        # Another instance may be running — check if it's recent
        if current_status in ACTIVE_STATUSES and not self.continuation:
            updated_at = status_doc.get("updated_at")
            if updated_at:
                if isinstance(updated_at, str):
                    updated_at = datetime.fromisoformat(updated_at)
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=timezone.utc)
                age_sec = (datetime.now(timezone.utc) - updated_at).total_seconds()
                if age_sec < STALE_THRESHOLD_SEC:
                    logger.info(
                        "Pipeline lock: %s is actively running (status='%s', updated %.0fs ago) — skipping duplicate",
                        self.collection_id, current_status, age_sec,
                    )
                    return False
                logger.warning(
                    "Pipeline lock: %s appears stale (status='%s', updated %.0fs ago) — proceeding",
                    self.collection_id, current_status, age_sec,
                )

        # Write our pipeline_run_id to claim this run
        run_id = str(uuid4())
        self.fs.update_collection_status(self.collection_id, pipeline_run_id=run_id)

        # Re-read to verify we won the race (simple optimistic lock)
        raw_doc2 = self.fs._db.collection("collection_status").document(self.collection_id).get()
        actual_run_id = (raw_doc2.to_dict() or {}).get("pipeline_run_id") if raw_doc2.exists else None
        if actual_run_id and actual_run_id != run_id:
            logger.info(
                "Pipeline lock: %s claimed by another instance (our=%s, theirs=%s) — aborting",
                self.collection_id, run_id[:8], actual_run_id[:8],
            )
            return False

        logger.info("Pipeline lock: acquired for %s (run_id=%s)", self.collection_id, run_id[:8])
        return True

    def _run_pipeline(self, pipeline_start: float) -> None:
        """Inner pipeline logic — called by run() inside try/except."""
        # Idempotency guard — prevent duplicate runs from Cloud Tasks retries
        if not self._acquire_pipeline_lock():
            return

        # Load config
        self._load_config()
        self._load_custom_fields()

        if self.continuation:
            self._log_task(
                f"Collection {self.collection_id[:8]}: resuming pipeline (continuation)",
                metadata={"phase": "processing", "continuation": True},
            )
        else:
            self._log_task(f"Collection {self.collection_id[:8]}: starting data collection")

        # Continuations skip re-init — posts are already in the DAG from the prior run.
        # Fresh runs reset DAG counters on the Firestore doc.
        if not self.continuation:
            self.fs.update_collection_status(
                self.collection_id,
                status="running",
                counts={},
                total_posts_in_dag=0,
                crawlers={},
            )

        # Build step context
        ctx = StepContext(
            collection_id=self.collection_id,
            bq=self.bq,
            gcs=self.gcs,
            state_manager=self.state_manager,
            custom_fields=self._custom_fields,
            enrichment_context=self._enrichment_context,
            settings=self.settings,
            content_types=self._content_types,
        )

        crawl_thread: threading.Thread | None = None
        if self.continuation:
            # Continuation: crawl is already done in the prior run. Mark it complete
            # so the processing loop can exit when all posts are terminal.
            # If the DAG is empty (e.g. continuation dispatched by snapshot recovery
            # after the original run exited before seeding), seed from BQ now.
            if self.state_manager.get_total_posts() == 0:
                self._seed_post_states_from_bq()
            self._crawl_complete.set()
            self._total_posts_collected = self.state_manager.get_total_posts()
        else:
            crawl_thread = threading.Thread(
                target=self._crawl,
                daemon=True,
                name=f"crawl-{self.collection_id[:8]}",
            )
            crawl_thread.start()

        # Run processing loop (overlaps with crawl on fresh runs)
        self._run_loop(ctx)

        # Wait for crawl thread to finish (should already be done)
        if crawl_thread is not None:
            crawl_thread.join(timeout=10)

        # Self-rescheduled continuation — exit cleanly, leave status=running for next run
        if self._continuation_scheduled:
            logger.info(
                "Pipeline %s handed off to continuation after %.1fs",
                self.collection_id, _time.monotonic() - pipeline_start,
            )
            return

        # Check if cancelled or failed
        status = self.fs.get_collection_status(self.collection_id)
        if (status or {}).get("status") == "failed":
            logger.info("Pipeline %s cancelled", self.collection_id)
            self._check_agent_completion()
            return

        if self._crawl_error and self._total_posts_collected == 0:
            self.fs.update_collection_status(
                self.collection_id,
                status="failed",
                error_message=f"Crawl failed: {self._crawl_error[:500]}",
            )
            logger.error("Pipeline %s failed: crawl error with 0 posts", self.collection_id)
            self._check_agent_completion()
            return

        # Reconcile counters (fixes drift from incremental updates)
        self.state_manager.recount()

        # Collection gates
        self._log_task("Computing analytics and generating insights...", metadata={"phase": "analytics"})
        self._run_collection_gates()

        # Final status
        self._set_final_status()

        # Check if this collection is part of a task — trigger continuation if all done
        self._check_agent_completion()

        # Cleanup post states (transient data)
        try:
            self.state_manager.cleanup_post_states()
        except Exception:
            logger.exception("Failed to cleanup post states for %s", self.collection_id)


        self._log_task(
            f"Collection {self.collection_id[:8]}: pipeline complete — {self._total_posts_collected} posts collected",
            metadata={"posts_collected": self._total_posts_collected},
        )

        logger.info(
            "━━━ Pipeline V2 DONE %s — total=%.1fs ━━━",
            self.collection_id,
            _time.monotonic() - pipeline_start,
        )

    def _schedule_continuation(self) -> bool:
        """Enqueue a Cloud Task to resume this pipeline. Returns True on success.

        Called when the processing loop approaches the Cloud Run timeout. The
        continuation picks up remaining non-terminal posts without re-running
        the crawl.
        """
        try:
            from google.cloud import tasks_v2
        except Exception:
            logger.exception("Cannot import tasks_v2 — continuation not scheduled for %s", self.collection_id)
            return False

        worker_url = (self.settings.worker_service_url or "").rstrip("/")
        if not worker_url:
            logger.warning(
                "worker_service_url not set — cannot schedule continuation for %s",
                self.collection_id,
            )
            return False

        try:
            # Clear pipeline_run_id so the continuation can acquire the lock cleanly
            self.fs.update_collection_status(self.collection_id, pipeline_run_id="")

            client = tasks_v2.CloudTasksClient()
            parent = client.queue_path(
                self.settings.gcp_project_id,
                self.settings.gcp_region,
                self.settings.cloud_tasks_queue,
            )
            http_request = {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/collection/run",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "collection_id": self.collection_id,
                    "continuation": True,
                }).encode(),
            }
            if self.settings.cloud_tasks_service_account:
                http_request["oidc_token"] = {
                    "service_account_email": self.settings.cloud_tasks_service_account,
                    "audience": worker_url,
                }
            task = {
                "http_request": http_request,
                "dispatch_deadline": {"seconds": 1800},
            }
            client.create_task(parent=parent, task=task)
            logger.info("Dispatched continuation Cloud Task for %s", self.collection_id)
            self._log_task(
                "Processing will continue in a follow-up run (time budget exceeded)",
                metadata={"phase": "processing", "continuation": True},
            )
            return True
        except Exception:
            logger.exception("Failed to schedule continuation for %s", self.collection_id)
            return False

    # ------------------------------------------------------------------
    # Config loading
    # ------------------------------------------------------------------

    def _load_config(self) -> None:
        rows = self.bq.query(
            "SELECT config, original_question FROM social_listening.collections "
            "WHERE collection_id = @collection_id",
            {"collection_id": self.collection_id},
        )
        if not rows:
            raise ValueError(f"Collection {self.collection_id} not found in BigQuery")

        config = rows[0]["config"]
        if isinstance(config, str):
            config = json.loads(config)

        self._status_doc = self.fs.get_collection_status(self.collection_id) or {}
        self._config = config

    def _load_custom_fields(self) -> None:
        from workers.enrichment.schema import CustomFieldDef

        raw_cf = self._config.get("custom_fields")
        if raw_cf:
            self._custom_fields = [CustomFieldDef(**f) for f in raw_cf]
        self._enrichment_context = self._config.get("enrichment_context")
        raw_ct = self._config.get("content_types")
        if raw_ct:
            self._content_types = [str(t).strip() for t in raw_ct if str(t).strip()]

    # ------------------------------------------------------------------
    # Crawl recovery
    # ------------------------------------------------------------------

    def _seed_post_states_from_bq(self) -> None:
        """Populate post states from existing BQ data when crawl is skipped.

        This handles re-runs where data is already in BQ but post_states
        were cleaned up. Reads posts from BQ and marks them as collected
        so the processing loop can pick them up for enrichment/embedding.
        """
        # Only seed if no post states exist yet
        if self.state_manager.get_total_posts() > 0:
            logger.info("Post states already populated for %s, skipping seed", self.collection_id)
            return

        rows = self.bq.query(
            "SELECT post_id, platform, channel_handle, post_url, posted_at, "
            "post_type, title, content, media_refs "
            "FROM social_listening.posts WHERE collection_id = @cid",
            {"cid": self.collection_id},
        )
        if not rows:
            logger.warning("No posts found in BQ for %s", self.collection_id)
            return

        # Dedup by post_id
        seen: set[str] = set()
        unique_rows = []
        for r in rows:
            if r["post_id"] not in seen:
                seen.add(r["post_id"])
                unique_rows.append(r)

        # Convert to Post objects for mark_collected
        posts = []
        for r in unique_rows:
            media_urls = []
            raw_refs = r.get("media_refs")
            if raw_refs:
                if isinstance(raw_refs, str):
                    raw_refs = json.loads(raw_refs)
                for ref in raw_refs or []:
                    if isinstance(ref, dict):
                        url = ref.get("original_url", "")
                        if url:
                            media_urls.append(url)

            posted_at = r.get("posted_at") or datetime.now(timezone.utc)
            posts.append(Post(
                post_id=r["post_id"],
                platform=r.get("platform", "") or "",
                channel_handle=r.get("channel_handle", "") or "",
                post_url=r.get("post_url", "") or "",
                posted_at=posted_at,
                post_type=r.get("post_type", "") or "",
                title=r.get("title"),
                content=r.get("content"),
                media_urls=media_urls,
            ))

        self.state_manager.mark_collected(posts)
        self._total_posts_collected = len(posts)

        self.fs.update_collection_status(
            self.collection_id,
            posts_collected=len(posts),
        )

        logger.info(
            "Seeded %d post states from BQ for %s",
            len(posts), self.collection_id,
        )

    # ------------------------------------------------------------------
    # Crawl
    # ------------------------------------------------------------------

    def _crawl(self) -> None:
        """Background thread: crawl all platforms, write posts to BQ, set states."""
        try:
            self._do_crawl()
        except Exception as e:
            self._crawl_error = str(e)
            logger.exception("Crawl failed for %s", self.collection_id)
            self.state_manager.set_crawler_status(
                "all", "failed", error=str(e)[:500]
            )
        finally:
            self._crawl_complete.set()

    def _count_downloaded_snapshots(self) -> int:
        """Count how many snapshots have already been downloaded for this collection."""
        try:
            db = self.fs._db
            docs = (
                db.collection("bd_snapshots")
                .where("collection_id", "==", self.collection_id)
                .where("status", "==", "downloaded")
                .stream()
            )
            return sum(1 for _ in docs)
        except Exception:
            logger.warning("Failed to count downloaded snapshots", exc_info=True)
            return 0

    def _do_crawl(self) -> None:
        # Skip crawl if this collection already has snapshots (prevents duplicate scraping on retries)
        existing_snapshots = self.fs.get_pending_snapshots(collection_id=self.collection_id)
        downloaded_count = self._count_downloaded_snapshots()
        if existing_snapshots:
            logger.info(
                "Crawl skipped for %s: %d pending snapshots exist (recovery will handle them)",
                self.collection_id, len(existing_snapshots),
            )
            self._crawl_complete.set()
            return
        if downloaded_count > 0:
            logger.info(
                "Crawl skipped for %s: %d snapshots already downloaded (data already in BQ)",
                self.collection_id, downloaded_count,
            )
            # Seed post states from BQ so the processing loop can pick them up
            self._seed_post_states_from_bq()
            self._crawl_complete.set()
            return

        def _track_snapshot(snapshot_id, dataset_id, discover_by):
            self.fs.save_snapshot(self.collection_id, snapshot_id, dataset_id, discover_by)

        # Compute remaining snapshot budget (per-agent aggregate)
        max_snapshots = self.settings.brightdata_max_snapshots_per_collection
        agent_id = self._status_doc.get("agent_id")
        if agent_id:
            try:
                agent_total = self.fs.get_agent_snapshot_count(agent_id)
                agent_remaining = max(0, self.settings.brightdata_max_snapshots_per_task - agent_total)
                max_snapshots = min(max_snapshots, agent_remaining)
                logger.info(
                    "Snapshot budget: agent %s used %d/%d, this collection gets %d",
                    agent_id[:8], agent_total, self.settings.brightdata_max_snapshots_per_task, max_snapshots,
                )
            except Exception:
                logger.warning("Failed to compute agent snapshot budget, using per-collection default", exc_info=True)

        wrapper = DataProviderWrapper(config=self._config, snapshot_tracker=_track_snapshot, max_snapshots=max_snapshots)

        owner_user_id = self._status_doc.get("user_id")
        owner_org_id = self._status_doc.get("org_id")

        seen_post_ids: set[str] = set()
        seen_channel_ids: set[str] = set()
        total_posts = 0
        funnel_worker_dedup = 0
        funnel_bq_insert_failures = 0
        collection_started_at = datetime.now(timezone.utc).isoformat()
        collection_start = _time.monotonic()

        batch_index = 0
        for batch in wrapper.collect_all():
            batch_index += 1

            # Check for cancellation
            status = self.fs.get_collection_status(self.collection_id)
            if status and status.get("status") == "failed":
                logger.info("Collection %s cancelled during crawl", self.collection_id)
                return

            # In-memory dedup within this run
            new_posts = [p for p in batch.posts if p.post_id not in seen_post_ids]
            funnel_worker_dedup += len(batch.posts) - len(new_posts)
            seen_post_ids.update(p.post_id for p in new_posts)
            new_channels = [c for c in batch.channels if c.channel_id not in seen_channel_ids]
            seen_channel_ids.update(c.channel_id for c in new_channels)

            if not new_posts:
                continue

            # Seed media_refs from CDN URLs so posts display immediately
            for p in new_posts:
                if p.media_urls and not p.media_refs:
                    p.media_refs = [
                        {
                            "original_url": url,
                            "media_type": "video"
                            if any(
                                ext in url.lower()
                                for ext in (
                                    ".mp4", ".mov", ".webm", "mime_type=video",
                                    "googlevideo.com", "videoplayback", "v.redd.it",
                                )
                            )
                            else "image",
                            "content_type": "",
                        }
                        for url in p.media_urls
                    ]

            # Write posts to BQ (always — no dedup, timestamps differentiate)
            post_rows = [post_to_bq_row(p, self.collection_id) for p in new_posts]
            failed_posts = self.bq.insert_rows("posts", post_rows)
            funnel_bq_insert_failures += failed_posts

            # Engagements + channels
            engagement_rows = [post_to_engagement_row(p) for p in new_posts]
            if engagement_rows:
                self.bq.insert_rows("post_engagements", engagement_rows)
            channel_rows = [channel_to_bq_row(c, self.collection_id) for c in new_channels]
            if channel_rows:
                self.bq.insert_rows("channels", channel_rows)

            total_posts += len(new_posts) - failed_posts
            self._total_posts_collected = total_posts

            # Update collection-level progress
            self.fs.update_collection_status(
                self.collection_id,
                posts_collected=total_posts,
                last_run_posts_added=total_posts,
            )

            # Classify posts and set initial pipeline state
            self.state_manager.mark_collected(new_posts)

            # Usage tracking (fire-and-forget)
            actual_stored = len(new_posts) - failed_posts
            if owner_user_id and actual_stored > 0:
                self.fs.increment_usage(owner_user_id, owner_org_id, "posts_collected", actual_stored)
                def _log_event(uid=owner_user_id, oid=owner_org_id, cid=self.collection_id, cnt=actual_stored):
                    try:
                        self.bq.insert_rows("usage_events", [{
                            "event_id": str(uuid4()),
                            "event_type": "posts_collected",
                            "user_id": uid,
                            "org_id": oid,
                            "collection_id": cid,
                            "metadata": json.dumps({"count": cnt}),
                        }])
                    except Exception:
                        logger.warning("Failed to log posts_collected event", exc_info=True)
                threading.Thread(target=_log_event, daemon=True).start()

            # Log progress to task activity feed (every 3 batches to avoid spam)
            if batch_index % 3 == 1 or batch_index == 1:
                platforms_str = ", ".join(sorted({p.platform for p in new_posts}))
                self._log_task(
                    f"Collected {total_posts} posts so far ({platforms_str})",
                    metadata={"phase": "collecting", "posts_collected": total_posts},
                )

            logger.info(
                "Batch %d: %d posts written to BQ, states set in Firestore",
                batch_index, len(new_posts),
            )

        # Crawl complete
        duration = round(_time.monotonic() - collection_start, 1)
        errors = wrapper.get_collection_errors()
        stats = wrapper.get_platform_stats()

        # Set crawler statuses from platform stats
        for platform, pstats in stats.items():
            has_error = pstats.get("errors", 0) > 0
            self.state_manager.set_crawler_status(
                platform,
                "success" if not has_error else "success",
                posts=pstats.get("posts", 0),
                error=str(errors) if has_error else "",
            )

        if not stats:
            self.state_manager.set_crawler_status("all", "success", posts=total_posts)

        # Store run_log
        run_log = {
            "collection": {
                "started_at": collection_started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "duration_sec": duration,
                "platforms": stats,
            },
            "funnel": {
                **wrapper.get_funnel_stats(),
                "worker_in_memory_dedup": funnel_worker_dedup,
                "worker_bq_dedup": 0,  # v2 skips BQ dedup by design
                "worker_bq_insert_failures": funnel_bq_insert_failures,
                "worker_posts_stored": total_posts,
            },
        }
        if errors:
            run_log["collection"]["errors"] = errors

        self.fs.update_collection_status(
            self.collection_id,
            run_log=run_log,
        )

        # Task activity: crawl complete summary
        if errors:
            error_platforms = [e.get("platform", "unknown") for e in errors]
            self._log_task(
                f"Data collection complete: {total_posts} posts. Some sources had issues ({', '.join(error_platforms)}) — continuing with available data.",
                level="warning",
                metadata={"phase": "collecting", "posts_collected": total_posts, "errors": len(errors)},
            )
        elif total_posts > 0:
            platform_summary = ", ".join(f"{p}: {s.get('posts', 0)}" for p, s in stats.items())
            self._log_task(
                f"Data collection complete: {total_posts} posts ({platform_summary}). Processing...",
                metadata={"phase": "processing", "posts_collected": total_posts},
            )

        if total_posts == 0:
            self.fs.update_collection_status(
                self.collection_id,
                status="failed",
                error_message="No posts were collected.",
                run_log=run_log,
            )

        logger.info(
            "Crawl complete for %s: %d posts in %.1fs",
            self.collection_id, total_posts, duration,
        )

    # ------------------------------------------------------------------
    # Processing loop
    # ------------------------------------------------------------------

    def _run_step(self, step, ctx: StepContext) -> bool:
        """Execute one step iteration. Returns True if it did any work.

        Safe to run concurrently with other steps: each step reads a disjoint
        input state and writes a disjoint output state, so no two steps pick
        up the same post. Firestore Increment counters are atomic.
        """
        try:
            ready = self.state_manager.get_posts_by_state(
                step.input_states, limit=step.batch_size
            )
        except Exception:
            logger.warning(
                "Transient error querying state for step '%s' in %s, skipping iteration",
                step.name, self.collection_id, exc_info=True,
            )
            return False

        if not ready:
            return False

        logger.info("Step '%s': processing %d posts", step.name, len(ready))

        try:
            results = step.action(ready, ctx)
        except Exception:
            logger.exception("Step '%s' crashed for %s", step.name, self.collection_id)
            results = [(p["post_id"], "fail", None) for p in ready]

        transitions: list[tuple[str, PostState]] = []
        media_refs: dict[str, list[dict]] = {}
        for post_id, outcome, extra in results:
            new_state = step.success_state if outcome == "ok" else step.failure_state
            transitions.append((post_id, new_state))
            if extra and "media_refs" in extra:
                media_refs[post_id] = extra["media_refs"]

        try:
            self.state_manager.transition_batch(transitions, media_refs=media_refs)
        except Exception:
            logger.exception(
                "Failed to transition %d posts for step '%s' in %s",
                len(transitions), step.name, self.collection_id,
            )
            return True  # attempted work — posts will be re-picked up next iter

        # After download step, persist GCS URIs back to BQ in the background
        if step.name == "download" and media_refs:
            refs_copy = dict(media_refs)
            threading.Thread(
                target=self._update_bq_media_refs,
                args=(refs_copy,),
                daemon=True,
                name=f"bq-media-update-{self.collection_id[:8]}",
            ).start()

        return True

    def _log_progress(self) -> None:
        """Periodic progress log — called once per loop iter, not per step."""
        counts = self.state_manager.get_counts()
        done = counts.get("DONE", 0)
        total = self.state_manager.get_total_posts()
        enriched = counts.get("ENRICHED", 0) + done
        downloading = counts.get("COLLECTED_WITH_MEDIA", 0)
        if total <= 0:
            return
        self.fs.update_collection_status(
            self.collection_id, posts_enriched=enriched,
        )
        parts = [f"{enriched}/{total} posts enriched"]
        if downloading > 0:
            parts.append(f"{downloading} downloading media")
        msg = f"Processing: {', '.join(parts)}"
        if not hasattr(self, "_last_progress_msg") or self._last_progress_msg != msg:
            self._last_progress_msg = msg
            self._log_task(
                msg,
                metadata={"phase": "processing", "enriched": enriched, "downloading": downloading, "total": total},
            )

    def _run_loop(self, ctx: StepContext) -> None:
        """Process posts through DAG steps until all terminal or timeout.

        Steps run concurrently per iteration via a ThreadPoolExecutor — download,
        enrich, and embed pull from disjoint input states, so while enrich waits
        on Gemini (the long pole), download keeps filling its queue.
        """
        logger.info("── Processing loop started for %s", self.collection_id)
        loop_start = _time.monotonic()
        last_progress_log = 0.0  # monotonic timestamp of last progress log

        with ThreadPoolExecutor(
            max_workers=len(PIPELINE_STEPS),
            thread_name_prefix=f"dag-{self.collection_id[:8]}",
        ) as step_pool:
            while True:
                elapsed = _time.monotonic() - loop_start

                # Hard timeout — should never hit this in normal runs now that
                # the soft timeout self-reschedules a continuation first.
                if elapsed > PIPELINE_LOOP_TIMEOUT:
                    logger.error(
                        "Processing loop timed out for %s after %.0fs", self.collection_id, elapsed
                    )
                    break

                # Soft timeout — self-reschedule a continuation if posts remain.
                if (
                    elapsed > PIPELINE_LOOP_SOFT_TIMEOUT
                    and not self._continuation_scheduled
                    and not self.state_manager.all_posts_terminal()
                ):
                    logger.info(
                        "Soft-timeout reached for %s at %.0fs — enqueueing continuation",
                        self.collection_id, elapsed,
                    )
                    if self._schedule_continuation():
                        self._continuation_scheduled = True
                        break

                # Check cancellation / failure (resilient to transient Firestore errors)
                try:
                    status = self.fs.get_collection_status(self.collection_id)
                except Exception:
                    logger.warning(
                        "Transient error reading status for %s, continuing",
                        self.collection_id, exc_info=True,
                    )
                    status = None

                if status and status.get("status") == "failed":
                    logger.info("Pipeline %s cancelled during processing", self.collection_id)
                    return

                # Run all steps concurrently — they pull disjoint input states
                futures = [
                    step_pool.submit(self._run_step, step, ctx)
                    for step in PIPELINE_STEPS
                ]
                any_work = False
                for f in futures:
                    try:
                        if f.result():
                            any_work = True
                    except Exception:
                        logger.exception("Step future raised for %s", self.collection_id)

                # Periodic progress log (once per iter)
                now = _time.monotonic()
                if any_work and now - last_progress_log > 30:
                    last_progress_log = now
                    self._log_progress()

                if not any_work:
                    if self._crawl_complete.is_set() and self.state_manager.all_posts_terminal():
                        break
                    if self._crawl_complete.is_set() and self.state_manager.get_total_posts() == 0:
                        break
                    _time.sleep(1)

        logger.info("── Processing loop complete for %s", self.collection_id)

    # ------------------------------------------------------------------
    # BQ media_refs update
    # ------------------------------------------------------------------

    def _update_bq_media_refs(self, media_refs: dict[str, list[dict]]) -> None:
        """Persist GCS URIs back to BQ posts table after download."""
        post_ids = list(media_refs.keys())
        refs_jsons = [json.dumps(media_refs[pid]) for pid in post_ids]

        sql = (
            "UPDATE social_listening.posts t "
            "SET t.media_refs = PARSE_JSON(s.refs_json) "
            "FROM ("
            "  SELECT pid, rj AS refs_json"
            "  FROM UNNEST(@post_ids) pid WITH OFFSET o1"
            "  JOIN UNNEST(@refs_jsons) rj WITH OFFSET o2 ON o1 = o2"
            ") s "
            "WHERE t.post_id = s.pid"
        )

        max_retries = 5
        for attempt in range(max_retries):
            try:
                self.bq.query(sql, {"post_ids": post_ids, "refs_jsons": refs_jsons})
                logger.info(
                    "Updated media_refs in BQ for %d posts", len(post_ids)
                )
                return
            except Exception as e:
                err_str = str(e)
                if "streaming buffer" in err_str.lower() and attempt < max_retries - 1:
                    retry_wait = 60 * (attempt + 1)
                    logger.info(
                        "Streaming buffer not flushed, retrying in %ds (attempt %d/%d)",
                        retry_wait, attempt + 1, max_retries,
                    )
                    _time.sleep(retry_wait)
                else:
                    logger.warning(
                        "media_refs BQ update failed: %s", err_str[:200]
                    )
                    return

    # ------------------------------------------------------------------
    # Crash recovery
    # ------------------------------------------------------------------

    @staticmethod
    def _friendly_error(error: str) -> str:
        """Map raw exception strings to user-friendly messages."""
        err_lower = error.lower()
        if "ssl" in err_lower or "eof occurred" in err_lower or "connection reset" in err_lower:
            return "Temporary connection issue with our infrastructure. Your data is safe — please retry."
        if "timeout" in err_lower and "brightdata" in err_lower:
            return "Data collection took longer than expected. Partial results may be available."
        if "429" in error or "too many requests" in err_lower or "rate limit" in err_lower:
            return "Rate limited by the social platform. Please try again in a few minutes."
        if "quota" in err_lower:
            return "API quota exceeded. Please try again later."
        return f"Pipeline error: {error[:300]}"

    def _set_crashed_status(self, error: str) -> None:
        """Set status to failed after an unhandled crash.

        Best-effort — if even this fails, we log and give up.
        """
        try:
            # Reconcile counters so the UI shows accurate numbers
            self.state_manager.recount()
        except Exception:
            logger.warning("Could not recount after crash for %s", self.collection_id)

        friendly = self._friendly_error(error)

        # If we have partial data, still mark as success (partial data is usable)
        final_status = "failed"
        if self._total_posts_collected > 0:
            final_status = "success"
            friendly = f"{friendly} ({self._total_posts_collected} posts collected before the error.)"

        try:
            self.fs.update_collection_status(
                self.collection_id,
                status=final_status,
                error_message=friendly,
            )
        except Exception:
            logger.exception(
                "CRITICAL: Could not update status after crash for %s", self.collection_id
            )

        # Log to task activity
        self._log_task(friendly, level="error")

        # Trigger agent continuation so the agent doesn't stay stuck in "running"
        self._check_agent_completion()

    # ------------------------------------------------------------------
    # Collection gates
    # ------------------------------------------------------------------

    def _run_collection_gates(self) -> None:
        """Run collection-level steps after all posts are terminal."""
        from workers.clustering.worker import run_clustering
        from workers.enrichment.worker import update_enrichment_counts
        from workers.shared.statistical_signature import refresh_statistical_signature

        logger.info("── Running collection gates for %s", self.collection_id)

        # Update enrichment counts and log final tally
        try:
            update_enrichment_counts(self.collection_id)
            cs = self.fs.get_collection_status(self.collection_id) or {}
            enriched = cs.get("posts_enriched", 0)
            total = cs.get("posts_collected", 0)
            if total > 0:
                self._log_task(
                    f"Enrichment complete: {enriched}/{total} posts",
                    metadata={"phase": "processing", "enriched": enriched, "total": total},
                )
        except Exception:
            logger.exception("Failed to update enrichment counts for %s", self.collection_id)

        # Statistical signature
        try:
            sig = refresh_statistical_signature(self.collection_id, self.bq, self.fs)
            eng = sig.get("engagement_summary") or {}
            total_views = int(eng.get("total_views") or 0)
            total_posts = int(sig.get("total_posts") or 0)
            positive = next(
                (r for r in sig.get("sentiment_breakdown", []) if r["value"] == "positive"),
                None,
            )
            positive_pct = None
            if positive:
                if total_views > 0:
                    positive_pct = round(positive["view_count"] / total_views * 100, 1)
                elif total_posts > 0:
                    positive_pct = round(positive["post_count"] / total_posts * 100, 1)
            self.fs.update_collection_status(
                self.collection_id,
                total_views=total_views,
                positive_pct=positive_pct,
            )
        except Exception:
            logger.exception("Statistical signature failed for %s", self.collection_id)

        # Update embedded count
        try:
            rows = self.bq.query(
                "SELECT COUNT(*) as cnt FROM social_listening.post_embeddings pe "
                "JOIN social_listening.posts p ON p.post_id = pe.post_id "
                "WHERE p.collection_id = @collection_id",
                {"collection_id": self.collection_id},
            )
            embedded_count = rows[0]["cnt"] if rows else 0
            self.fs.update_collection_status(self.collection_id, posts_embedded=embedded_count)
        except Exception:
            logger.exception("Failed to update embedded count for %s", self.collection_id)

        # Topic clustering (agent-wide)
        try:
            agent_id = self._get_agent_id()
            if agent_id:
                agent_doc = self.fs.get_agent(agent_id)
                collection_ids = (agent_doc or {}).get("collection_ids", [])
                result = run_clustering(agent_id, collection_ids)
                logger.info(
                    "Topic clustering: %d topics for agent %s",
                    result.get("topics_count", 0), agent_id,
                )
            else:
                logger.info("No agent_id for %s — skipping topic clustering", self.collection_id)
        except Exception:
            logger.exception("Topic clustering failed for %s", self.collection_id)

    # ------------------------------------------------------------------
    # Final status
    # ------------------------------------------------------------------

    def _set_final_status(self) -> None:
        """Set the final collection status, handling ongoing scheduling."""
        status = self.fs.get_collection_status(self.collection_id)
        current_status = (status or {}).get("status")
        config = (status or {}).get("config") or {}

        if current_status == "failed":
            return

        self.fs.update_collection_status(self.collection_id, status="success")
