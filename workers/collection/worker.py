"""Collection Worker — gathers social data and stores it in BigQuery + GCS.

Usage:
    python -m workers.collection.worker <collection_id>
"""

import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

from config.settings import get_settings
from workers.collection.media_downloader import download_media_batch
from workers.collection.normalizer import (
    channel_to_bq_row,
    post_to_bq_row,
    post_to_engagement_row,
    seed_media_refs,
)
from workers.collection.wrapper import DataProviderWrapper
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

# Limit concurrent media download batches to avoid connection pool exhaustion.
# With 7+ batch threads running in parallel, each with 10 download workers,
# unconstrained this creates 70+ simultaneous connections to i.redd.it / GCS.
_DOWNLOAD_BATCH_SEMAPHORE = threading.Semaphore(3)

# Ensure collection logs are written to logs/worker.log (git-ignored)
_log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
os.makedirs(_log_dir, exist_ok=True)
_log_file = os.path.join(_log_dir, "worker.log")
if not any(isinstance(h, logging.FileHandler) and h.baseFilename == os.path.abspath(_log_file) for h in logging.getLogger().handlers):
    _fh = logging.FileHandler(_log_file, encoding="utf-8")
    _fh.setLevel(logging.INFO)
    _fh.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    _root = logging.getLogger()
    _root.addHandler(_fh)
    # Ensure root logger passes INFO+ to handlers (default is WARNING)
    if _root.level > logging.INFO:
        _root.setLevel(logging.INFO)



def run_collection(collection_id: str, on_batch_complete=None) -> None:
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)
    gcs = GCSClient(settings)

    # Read collection config from BQ
    rows = bq.query(
        "SELECT config, original_question FROM social_listening.collections WHERE collection_id = @collection_id",
        {"collection_id": collection_id},
    )
    if not rows:
        raise ValueError(f"Collection {collection_id} not found in BigQuery")

    config = rows[0]["config"]
    if isinstance(config, str):
        config = json.loads(config)

    status_doc = fs.get_collection_status(collection_id)
    owner_user_id = status_doc.get("user_id") if status_doc else None
    owner_org_id = status_doc.get("org_id") if status_doc else None

    fs.update_collection_status(collection_id, status="collecting")
    logger.info("Starting collection %s", collection_id)

    def _track_snapshot(snapshot_id, dataset_id, discover_by):
        fs.save_snapshot(collection_id, snapshot_id, dataset_id, discover_by)

    wrapper = DataProviderWrapper(config=config, snapshot_tracker=_track_snapshot)
    total_posts = 0
    total_dupes = 0
    seen_post_ids: set[str] = set()
    seen_channel_ids: set[str] = set()
    funnel_worker_dedup = 0
    funnel_bq_dedup = 0
    funnel_bq_insert_failures = 0
    collection_start = time.monotonic()
    collection_started_at = datetime.now(timezone.utc).isoformat()

    try:
        batch_index = 0
        _batch_threads: list[threading.Thread] = []  # join before returning
        for batch in wrapper.collect_all():
            t_batch = time.monotonic()
            batch_index += 1
            # Check for cancellation before processing each batch
            status = fs.get_collection_status(collection_id)
            if status and status.get("status") == "cancelled":
                logger.info("Collection %s was cancelled by user", collection_id)
                return

            # Deduplicate posts and channels within this collection run
            new_posts = [p for p in batch.posts if p.post_id not in seen_post_ids]
            funnel_worker_dedup += len(batch.posts) - len(new_posts)
            seen_post_ids.update(p.post_id for p in new_posts)

            new_channels = [c for c in batch.channels if c.channel_id not in seen_channel_ids]
            seen_channel_ids.update(c.channel_id for c in new_channels)

            if not new_posts:
                continue

            # Same-collection dedup: skip posts already in BQ for THIS collection
            # (handles re-runs of ongoing collections without blocking cross-collection overlap)
            existing = bq.query(
                "SELECT DISTINCT post_id FROM social_listening.posts "
                "WHERE collection_id = @collection_id AND post_id IN UNNEST(@post_ids)",
                {"collection_id": collection_id, "post_ids": [p.post_id for p in new_posts]},
            )
            existing_ids = {r["post_id"] for r in existing}
            if existing_ids:
                # Refresh engagements for existing posts (append new time-series snapshot)
                dupe_posts = [p for p in new_posts if p.post_id in existing_ids]
                refresh_rows = [post_to_engagement_row(p) for p in dupe_posts]
                for row in refresh_rows:
                    row["source"] = "dedup_refresh"
                if refresh_rows:
                    bq.insert_rows("post_engagements", refresh_rows)

                # Refresh channel data for existing posts' channels
                dupe_channel_ids = {p.channel_id for p in dupe_posts if p.channel_id}
                refresh_channels = [c for c in batch.channels if c.channel_id in dupe_channel_ids]
                if refresh_channels:
                    channel_rows = [channel_to_bq_row(c, collection_id) for c in refresh_channels]
                    bq.insert_rows("channels", channel_rows)

                logger.info(
                    "Collection %s: dedup — %d existing posts (refreshed engagements + %d channels), keeping %d new",
                    collection_id, len(existing_ids), len(refresh_channels),
                    len(new_posts) - len(existing_ids),
                )
                total_dupes += len(existing_ids)
                funnel_bq_dedup += len(existing_ids)
                new_posts = [p for p in new_posts if p.post_id not in existing_ids]

            if not new_posts:
                continue

            # Seed media_refs from original CDN URLs so posts display images immediately
            for p in new_posts:
                seed_media_refs(p)
            # Insert posts FIRST so they appear in the feed immediately
            failed_posts = 0
            post_rows = [post_to_bq_row(p, collection_id) for p in new_posts]
            t_bq_insert = time.monotonic()
            if post_rows:
                failed_posts = bq.insert_rows("posts", post_rows)
                funnel_bq_insert_failures += failed_posts

            # Insert initial engagements
            engagement_rows = [post_to_engagement_row(p) for p in new_posts]
            if engagement_rows:
                bq.insert_rows("post_engagements", engagement_rows)

            # Insert channels
            channel_rows = [channel_to_bq_row(c, collection_id) for c in new_channels]
            if channel_rows:
                bq.insert_rows("channels", channel_rows)

            dupes_in_batch = len(batch.posts) - len(new_posts)
            total_posts += len(new_posts) - failed_posts
            total_dupes += dupes_in_batch
            fs.update_collection_status(
                collection_id,
                posts_collected=total_posts,
            )

            # Track usage for billing + analytics (fire-and-forget)
            actual_stored = len(new_posts) - failed_posts
            if owner_user_id and actual_stored > 0:
                fs.increment_usage(owner_user_id, owner_org_id, "posts_collected", actual_stored)
                def _log_posts_event(uid=owner_user_id, oid=owner_org_id, cid=collection_id, cnt=actual_stored):
                    try:
                        bq.insert_rows("usage_events", [{
                            "event_id": str(uuid4()),
                            "event_type": "posts_collected",
                            "user_id": uid,
                            "org_id": oid,
                            "collection_id": cid,
                            "metadata": json.dumps({"count": cnt}),
                        }])
                    except Exception:
                        logger.warning("Failed to log posts_collected event to BQ", exc_info=True)
                threading.Thread(target=_log_posts_event, daemon=True).start()

            # Spawn a background thread: download media → enrich → persist GCS URIs to BQ.
            #
            # Posts are already in BQ with CDN URLs (seeded above), so the feed updates
            # immediately. The background thread then:
            #   1. Downloads media to GCS (all platforms except YouTube, which Gemini handles natively)
            #   2. Fires on_batch_complete() so enrichment runs with GCS URIs in media_refs
            #   3. Attempts to UPDATE media_refs in BQ with GCS URIs (best-effort, one try)
            #
            # All batch threads run concurrently — downloads and enrichment for all batches
            # happen in parallel, bounded only by the global enrichment semaphore.
            #
            # We join all threads before run_collection() returns so that pipeline.py can
            # safely wait on the enrichment executor shutdown.
            posts_needing_dl = [p for p in new_posts if p.platform != "youtube"]

            def _download_enrich_update(
                posts_copy=list(new_posts),
                dl_posts=list(posts_needing_dl),
                bidx=batch_index,
                cid=collection_id,
                t_insert=t_bq_insert,
            ):
                t0 = time.monotonic()

                # Step 1: Download media to GCS (throttled — max 3 batch threads
                # download simultaneously to prevent connection pool exhaustion)
                if dl_posts:
                    with _DOWNLOAD_BATCH_SEMAPHORE:
                        download_media_batch(gcs, dl_posts, cid)
                    logger.info(
                        "Batch %d media download done: %.1fs (%d posts)",
                        bidx, time.monotonic() - t0, len(dl_posts),
                    )

                # Step 2: Enrich — posts now have GCS URIs (or YouTube URLs) in media_refs
                if on_batch_complete:
                    on_batch_complete(posts_copy)

                # Step 3: Persist GCS URIs back to BQ.
                # BQ streaming inserts block DML for ~90s (sometimes longer).
                # Wait at least 95s from the insert, then retry with backoff
                # if the streaming buffer hasn't flushed yet.
                posts_with_gcs = [
                    p for p in posts_copy
                    if any(r.get("gcs_uri") for r in (p.media_refs or []))
                ]
                if posts_with_gcs:
                    wait = max(0, 120 - (time.monotonic() - t_insert))
                    if wait > 0:
                        logger.info("Batch %d: waiting %.0fs for BQ streaming buffer before media_refs update", bidx, wait)
                        time.sleep(wait)
                    post_ids = [p.post_id for p in posts_with_gcs]
                    refs_jsons = [json.dumps(p.media_refs) for p in posts_with_gcs]
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
                            bq.query(sql, {"post_ids": post_ids, "refs_jsons": refs_jsons})
                            logger.info("Batch %d: updated media_refs in BQ for %d posts", bidx, len(posts_with_gcs))
                            break
                        except Exception as e:
                            err_str = str(e)
                            if "streaming buffer" in err_str.lower() and attempt < max_retries - 1:
                                retry_wait = 60 * (attempt + 1)
                                logger.info("Batch %d: streaming buffer not flushed, retrying in %ds (attempt %d/%d)", bidx, retry_wait, attempt + 1, max_retries)
                                time.sleep(retry_wait)
                            else:
                                logger.warning("Batch %d: media_refs BQ update failed (%s)", bidx, err_str[:200])
                                break

                logger.info(
                    "Batch %d background complete: %.1fs total (download+enrich+bq_update)",
                    bidx, time.monotonic() - t0,
                )

            t = threading.Thread(target=_download_enrich_update, daemon=True)
            t.start()
            _batch_threads.append(t)

            batch_elapsed = time.monotonic() - t_batch
            logger.info(
                "Batch %d: %d posts inserted to BQ in %.1fs — download+enrich queued in background",
                batch_index, len(new_posts), batch_elapsed,
            )

        # Wait for all background download+enrich threads to complete before returning.
        # This ensures all enrichment callbacks have been submitted to the executor in
        # pipeline.py before it calls shutdown(wait=True) to collect results.
        if _batch_threads:
            logger.info("Waiting for %d background batch threads to complete...", len(_batch_threads))
            for t in _batch_threads:
                t.join()
            logger.info("All background batch threads done")

        # Build run_log with platform stats and timing
        duration_sec = round(time.monotonic() - collection_start, 1)
        collection_errors = wrapper.get_collection_errors()
        run_log = {
            "collection": {
                "started_at": collection_started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "duration_sec": duration_sec,
                "total_dupes_skipped": total_dupes,
                "platforms": wrapper.get_platform_stats(),
            },
            "funnel": {
                **wrapper.get_funnel_stats(),
                "worker_in_memory_dedup": funnel_worker_dedup,
                "worker_bq_dedup": funnel_bq_dedup,
                "worker_bq_insert_failures": funnel_bq_insert_failures,
                "worker_posts_stored": total_posts,
            },
        }
        if collection_errors:
            run_log["collection"]["errors"] = collection_errors
            logger.warning(
                "Collection %s had %d platform errors: %s",
                collection_id, len(collection_errors), collection_errors,
            )

        if total_posts == 0:
            error_msg = (
                f"No posts were collected after {duration_sec}s. "
                f"Platform stats: {wrapper.get_platform_stats()}. "
                f"Errors: {collection_errors or 'none'}. "
                f"Dupes skipped: {total_dupes}."
            )
            logger.error("Collection %s: %s", collection_id, error_msg)
            fs.update_collection_status(
                collection_id,
                status="failed",
                error_message="No posts were collected. The data provider returned no results or all results failed processing.",
                run_log=run_log,
            )
            return

        fs.update_collection_status(collection_id, status="enriching", run_log=run_log)
        logger.info("Collection %s completed: %d total posts in %.1fs", collection_id, total_posts, duration_sec)

    except Exception as e:
        logger.exception("Collection %s failed", collection_id)
        fs.update_collection_status(
            collection_id, status="failed", error_message=str(e)
        )
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if len(sys.argv) < 2:
        print("Usage: python -m workers.collection.worker <collection_id>")
        sys.exit(1)

    run_collection(sys.argv[1])
