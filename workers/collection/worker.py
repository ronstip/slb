"""Collection Worker — gathers social data and stores it in BigQuery + GCS.

Usage:
    python -m workers.collection.worker <collection_id>
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone

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


def run_collection(collection_id: str) -> None:
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

            # Download media to GCS (parallelized)
            download_media_batch(gcs, new_posts, collection_id)

            # Insert posts
            post_rows = [post_to_bq_row(p, collection_id) for p in new_posts]
            if post_rows:
                bq.insert_rows("posts", post_rows)

            # Insert initial engagements
            engagement_rows = [post_to_engagement_row(p) for p in new_posts]
            if engagement_rows:
                bq.insert_rows("post_engagements", engagement_rows)

            # Insert channels
            channel_rows = [channel_to_bq_row(c, collection_id) for c in new_channels]
            if channel_rows:
                bq.insert_rows("channels", channel_rows)

            dupes_in_batch = len(batch.posts) - len(new_posts)
            total_posts += len(new_posts)
            total_dupes += dupes_in_batch
            fs.update_collection_status(
                collection_id, posts_collected=total_posts
            )
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
        fs.update_collection_status(collection_id, status="completed", run_log=run_log)
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
