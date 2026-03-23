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
from datetime import datetime, timezone
from uuid import uuid4

from google.cloud.firestore_v1 import transforms

from config.settings import get_settings
from workers.collection.models import Post
from workers.collection.normalizer import (
    channel_to_bq_row,
    post_to_bq_row,
    post_to_engagement_row,
)
from workers.collection.wrapper import DataProviderWrapper
from workers.pipeline_v2.post_state import FAILURE_STATES, TERMINAL_STATES, PostState
from workers.pipeline_v2.schedule_utils import compute_next_run_at
from workers.pipeline_v2.state_manager import StateManager
from workers.pipeline_v2.steps import PIPELINE_STEPS, StepContext
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

MAX_CONSECUTIVE_FAILURES = 3
PIPELINE_LOOP_TIMEOUT = 3600  # 1 hour max for the processing loop


class PipelineRunner:
    """Runs the post-level DAG pipeline for a single collection."""

    def __init__(self, collection_id: str):
        self.collection_id = collection_id
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
        self._total_posts_collected = 0

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

    def _run_pipeline(self, pipeline_start: float) -> None:
        """Inner pipeline logic — called by run() inside try/except."""
        # Load config
        self._load_config()
        self._load_custom_fields()

        # Initialize counts on the Firestore doc
        self.fs.update_collection_status(
            self.collection_id,
            status="collecting",
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
            settings=self.settings,
        )

        # Start crawl in background
        crawl_thread = threading.Thread(
            target=self._crawl,
            daemon=True,
            name=f"crawl-{self.collection_id[:8]}",
        )
        crawl_thread.start()

        # Run processing loop (overlaps with crawl)
        self._run_loop(ctx)

        # Wait for crawl thread to finish (should already be done)
        crawl_thread.join(timeout=10)

        # Check if cancelled or failed
        status = self.fs.get_collection_status(self.collection_id)
        if (status or {}).get("status") == "cancelled":
            logger.info("Pipeline %s cancelled", self.collection_id)
            return

        if self._crawl_error and self._total_posts_collected == 0:
            self.fs.update_collection_status(
                self.collection_id,
                status="failed",
                error_message=f"Crawl failed: {self._crawl_error[:500]}",
            )
            logger.error("Pipeline %s failed: crawl error with 0 posts", self.collection_id)
            return

        # Reconcile counters (fixes drift from incremental updates)
        self.state_manager.recount()

        # Collection gates
        self._run_collection_gates()

        # Final status
        self._set_final_status()

        # Cleanup post states (transient data)
        try:
            self.state_manager.cleanup_post_states()
        except Exception:
            logger.exception("Failed to cleanup post states for %s", self.collection_id)


        logger.info(
            "━━━ Pipeline V2 DONE %s — total=%.1fs ━━━",
            self.collection_id,
            _time.monotonic() - pipeline_start,
        )

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

        # For ongoing collections on 2nd+ runs, use incremental window
        self._status_doc = self.fs.get_collection_status(self.collection_id) or {}
        last_run_at = self._status_doc.get("last_run_at")
        if last_run_at and config.get("ongoing"):
            config = dict(config)
            config["time_range"] = dict(config.get("time_range", {}))
            config["time_range"]["start"] = last_run_at[:10]

        self._config = config

    def _load_custom_fields(self) -> None:
        from workers.enrichment.schema import CustomFieldDef

        raw_cf = self._config.get("custom_fields")
        if raw_cf:
            self._custom_fields = [CustomFieldDef(**f) for f in raw_cf]

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

    def _do_crawl(self) -> None:
        wrapper = DataProviderWrapper(config=self._config)

        owner_user_id = self._status_doc.get("user_id")
        owner_org_id = self._status_doc.get("org_id")
        existing_posts = 0
        if self._status_doc.get("ongoing"):
            existing_posts = self._status_doc.get("posts_collected", 0) or 0

        seen_post_ids: set[str] = set()
        seen_channel_ids: set[str] = set()
        total_posts = 0
        collection_started_at = datetime.now(timezone.utc).isoformat()
        collection_start = _time.monotonic()

        batch_index = 0
        for batch in wrapper.collect_all():
            batch_index += 1

            # Check for cancellation
            status = self.fs.get_collection_status(self.collection_id)
            if status and status.get("status") == "cancelled":
                logger.info("Collection %s cancelled during crawl", self.collection_id)
                return

            # In-memory dedup within this run
            new_posts = [p for p in batch.posts if p.post_id not in seen_post_ids]
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
                posts_collected=existing_posts + total_posts,
                last_run_posts_added=total_posts,
            )

            # Classify posts and set initial pipeline state
            self.state_manager.mark_collected(new_posts)

            # Usage tracking (fire-and-forget)
            if owner_user_id and new_posts:
                self.fs.increment_usage(owner_user_id, owner_org_id, "posts_collected", len(new_posts))
                def _log_event(uid=owner_user_id, oid=owner_org_id, cid=self.collection_id, cnt=len(new_posts)):
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
                "completed" if not has_error else "completed_with_errors",
                posts=pstats.get("posts", 0),
                error=str(errors) if has_error else "",
            )

        if not stats:
            self.state_manager.set_crawler_status("all", "completed", posts=total_posts)

        # Store run_log
        run_log = {
            "collection": {
                "started_at": collection_started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "duration_sec": duration,
                "platforms": stats,
            },
        }
        if errors:
            run_log["collection"]["errors"] = errors

        self.fs.update_collection_status(
            self.collection_id,
            status="processing",
            run_log=run_log,
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

    def _run_loop(self, ctx: StepContext) -> None:
        """Process posts through DAG steps until all terminal or timeout."""
        logger.info("── Processing loop started for %s", self.collection_id)
        loop_start = _time.monotonic()

        while True:
            # Check timeout
            elapsed = _time.monotonic() - loop_start
            if elapsed > PIPELINE_LOOP_TIMEOUT:
                logger.error(
                    "Processing loop timed out for %s after %.0fs", self.collection_id, elapsed
                )
                break

            # Check cancellation / failure (with resilience to transient Firestore errors)
            try:
                status = self.fs.get_collection_status(self.collection_id)
            except Exception:
                logger.warning("Transient error reading status for %s, continuing", self.collection_id, exc_info=True)
                status = None

            if status and status.get("status") == "cancelled":
                logger.info("Pipeline %s cancelled during processing", self.collection_id)
                return

            if status and status.get("status") == "failed":
                logger.info("Pipeline %s failed during crawl, stopping loop", self.collection_id)
                return

            any_work = False
            for step in PIPELINE_STEPS:
                try:
                    ready = self.state_manager.get_posts_by_state(
                        step.input_states, limit=step.batch_size
                    )
                except Exception:
                    logger.warning(
                        "Transient error querying state for step '%s' in %s, skipping iteration",
                        step.name, self.collection_id, exc_info=True,
                    )
                    continue

                if not ready:
                    continue

                any_work = True
                logger.info(
                    "Step '%s': processing %d posts", step.name, len(ready)
                )

                try:
                    results = step.action(ready, ctx)
                except Exception:
                    logger.exception("Step '%s' crashed for %s", step.name, self.collection_id)
                    # Move all posts to failure state
                    results = [(p["post_id"], "fail", None) for p in ready]

                # Build transitions
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
                    # Don't crash the loop — posts will be re-picked up next iteration
                    continue

                # After download step, persist GCS URIs back to BQ (background — don't block loop)
                if step.name == "download" and media_refs:
                    refs_copy = dict(media_refs)
                    threading.Thread(
                        target=self._update_bq_media_refs,
                        args=(refs_copy,),
                        daemon=True,
                        name=f"bq-media-update-{self.collection_id[:8]}",
                    ).start()

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

    def _set_crashed_status(self, error: str) -> None:
        """Set status to failed after an unhandled crash.

        Best-effort — if even this fails, we log and give up.
        """
        try:
            # Reconcile counters so the UI shows accurate numbers
            self.state_manager.recount()
        except Exception:
            logger.warning("Could not recount after crash for %s", self.collection_id)

        try:
            self.fs.update_collection_status(
                self.collection_id,
                status="failed",
                error_message=f"Pipeline crashed: {error[:500]}",
            )
        except Exception:
            logger.exception(
                "CRITICAL: Could not update status after crash for %s", self.collection_id
            )

    # ------------------------------------------------------------------
    # Collection gates
    # ------------------------------------------------------------------

    def _run_collection_gates(self) -> None:
        """Run collection-level steps after all posts are terminal."""
        from workers.clustering.worker import run_clustering
        from workers.enrichment.worker import update_enrichment_counts
        from workers.shared.statistical_signature import refresh_statistical_signature

        logger.info("── Running collection gates for %s", self.collection_id)

        # Update enrichment counts
        try:
            update_enrichment_counts(self.collection_id)
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

        # Topic clustering
        try:
            result = run_clustering(self.collection_id)
            logger.info(
                "Topic clustering: %d topics for %s",
                result.get("topics_count", 0), self.collection_id,
            )
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

        if current_status in ("cancelled", "failed"):
            return

        # Check for actual pipeline processing failures (not input stumps like MISSING_MEDIA)
        counts = self.state_manager.get_counts()
        has_failures = any(
            counts.get(s.value, 0) > 0
            for s in FAILURE_STATES
        )

        ongoing_flag = (status or {}).get("ongoing", False)
        if not ongoing_flag and not config.get("ongoing"):
            final = "completed_with_errors" if has_failures else "completed"
            self.fs.update_collection_status(self.collection_id, status=final)
            return

        if config.get("ongoing"):
            schedule = config.get("schedule", "daily")
            now = datetime.now(timezone.utc)

            prev_next_run = (status or {}).get("next_run_at")
            if prev_next_run:
                if isinstance(prev_next_run, str):
                    prev_next_run = datetime.fromisoformat(prev_next_run)
                base_time = prev_next_run
            else:
                base_time = now
            next_run_at = compute_next_run_at(schedule, base_time)
            if next_run_at <= now:
                next_run_at = compute_next_run_at(schedule, now)

            run_status = "completed" if not has_failures else "completed_with_errors"
            run_entry = {
                "run_at": now.isoformat(),
                "posts_added": (status or {}).get("last_run_posts_added", 0),
                "status": run_status,
            }

            consecutive_failures = (status or {}).get("consecutive_failures", 0)
            if has_failures:
                consecutive_failures += 1
            else:
                consecutive_failures = 0

            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                self.fs.update_collection_status(
                    self.collection_id,
                    status="paused",
                    error_message=f"Auto-paused after {consecutive_failures} consecutive failures.",
                    consecutive_failures=consecutive_failures,
                    total_runs=transforms.Increment(1),
                    run_history=transforms.ArrayUnion([run_entry]),
                    last_run_at=now,
                )
                logger.warning(
                    "Ongoing collection %s paused after %d failures",
                    self.collection_id, consecutive_failures,
                )
                return

            self.fs.update_collection_status(
                self.collection_id,
                status="monitoring",
                last_run_at=now,
                next_run_at=next_run_at,
                total_runs=transforms.Increment(1),
                run_history=transforms.ArrayUnion([run_entry]),
                consecutive_failures=consecutive_failures,
            )
            logger.info(
                "Ongoing collection %s → monitoring; next run at %s",
                self.collection_id, next_run_at.isoformat(),
            )
        elif not has_failures:
            self.fs.update_collection_status(self.collection_id, status="completed")
        else:
            self.fs.update_collection_status(self.collection_id, status="completed_with_errors")
