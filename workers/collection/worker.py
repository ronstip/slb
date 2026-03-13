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
)
from workers.collection.wrapper import DataProviderWrapper
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

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


def _update_media_refs_in_bq(bq: 'BQClient', posts) -> None:
    """Batch-update media_refs in BQ for posts that have GCS URIs after download.

    BQ DML cannot touch rows that are still in the streaming buffer.
    Retries once after a 90s wait, which is enough for the buffer to clear.
    """
    cases = []
    post_ids = []
    for p in posts:
        refs_json = json.dumps(p.media_refs if isinstance(p.media_refs, list) else [])
        refs_json = refs_json.replace("\\", "\\\\").replace("'", "\\'")
        cases.append(f"WHEN '{p.post_id}' THEN PARSE_JSON('{refs_json}')")
        post_ids.append(p.post_id)

    if not cases:
        return

    sql = (
        "UPDATE social_listening.posts "
        f"SET media_refs = CASE post_id {' '.join(cases)} ELSE media_refs END "
        "WHERE post_id IN UNNEST(@post_ids)"
    )

    for attempt in range(2):
        try:
            bq.query(sql, {"post_ids": post_ids})
            logger.info("Updated media_refs in BQ for %d posts", len(post_ids))
            return
        except Exception as e:
            if "streaming buffer" in str(e) and attempt == 0:
                logger.info("media_refs UPDATE hit streaming buffer — retrying in 90s")
                time.sleep(90)
            else:
                logger.warning("Failed to update media_refs in BQ: %s", e)
                return


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

    # For ongoing collections on 2nd+ runs, use incremental window (since last run)
    status_doc = fs.get_collection_status(collection_id)
    owner_user_id = status_doc.get("user_id") if status_doc else None
    owner_org_id = status_doc.get("org_id") if status_doc else None
    last_run_at = status_doc.get("last_run_at") if status_doc else None
    if last_run_at and config.get("ongoing"):
        config = dict(config)
        config["time_range"] = dict(config.get("time_range", {}))
        config["time_range"]["start"] = last_run_at[:10]  # YYYY-MM-DD

    fs.update_collection_status(collection_id, status="collecting")
    logger.info("Starting collection %s", collection_id)

    wrapper = DataProviderWrapper(config=config)
    total_posts = 0
    total_dupes = 0
    seen_post_ids: set[str] = set()
    seen_channel_ids: set[str] = set()
    collection_start = time.monotonic()
    collection_started_at = datetime.now(timezone.utc).isoformat()

    try:
        for batch in wrapper.collect_all():
            # Check for cancellation before processing each batch
            status = fs.get_collection_status(collection_id)
            if status and status.get("status") == "cancelled":
                logger.info("Collection %s was cancelled by user", collection_id)
                return

            # Deduplicate posts and channels within this collection run
            new_posts = [p for p in batch.posts if p.post_id not in seen_post_ids]
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
                total_dupes += len(existing_ids)
                new_posts = [p for p in new_posts if p.post_id not in existing_ids]
                logger.info(
                    "Collection %s: same-collection dedup removed %d already-stored posts",
                    collection_id, len(existing_ids),
                )

            if not new_posts:
                continue

            # Seed media_refs from original CDN URLs so posts display images immediately
            for p in new_posts:
                if p.media_urls and not p.media_refs:
                    p.media_refs = [
                        {"original_url": url, "media_type": "video" if any(ext in url.lower() for ext in (".mp4", ".mov", ".webm", "mime_type=video", "googlevideo.com", "videoplayback", "v.redd.it")) else "image", "content_type": ""}
                        for url in p.media_urls
                    ]
            # Insert posts FIRST so they appear in the feed immediately
            failed_posts = 0
            post_rows = [post_to_bq_row(p, collection_id) for p in new_posts]
            if post_rows:
                failed_posts = bq.insert_rows("posts", post_rows)

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
                collection_id, posts_collected=total_posts
            )

            # Download media to GCS synchronously — posts are already visible in feed via
            # CDN URLs seeded above, so this doesn't block feed display. We MUST do this
            # before on_batch_complete so enrichment gets GCS URIs (required for videos).
            t_dl = time.monotonic()
            download_media_batch(gcs, new_posts, collection_id)
            logger.info("Download done in %.1fs", time.monotonic() - t_dl)

            # Persist GCS URIs back to BQ in background (non-blocking — enrichment uses
            # the already-updated in-memory refs, not BQ; BQ update is for re-enrichment).
            def _update_bq_bg(posts_copy=list(new_posts), cid=collection_id):
                try:
                    updated = [p for p in posts_copy if any(r.get("gcs_uri") for r in (p.media_refs or []))]
                    if updated:
                        _update_media_refs_in_bq(bq, updated)
                except Exception:
                    logger.warning("Background BQ media update failed for %s", cid, exc_info=True)
            threading.Thread(target=_update_bq_bg, daemon=True).start()

            # Track usage for billing + analytics
            if owner_user_id and len(new_posts) > 0:
                fs.increment_usage(owner_user_id, owner_org_id, "posts_collected", len(new_posts))
                # Fire-and-forget BQ event log for admin activity dashboard
                def _log_posts_event(uid=owner_user_id, oid=owner_org_id, cid=collection_id, cnt=len(new_posts)):
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
            # Notify callback (e.g., for parallel enrichment)
            if on_batch_complete and new_posts:
                on_batch_complete(new_posts)

            logger.info("Collection %s: %d posts so far (%d dupes skipped)", collection_id, total_posts, dupes_in_batch)

        # Build run_log with platform stats and timing
        duration_sec = round(time.monotonic() - collection_start, 1)
        run_log = {
            "collection": {
                "started_at": collection_started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "duration_sec": duration_sec,
                "total_dupes_skipped": total_dupes,
                "platforms": wrapper.get_platform_stats(),
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
