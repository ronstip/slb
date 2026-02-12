"""Collection Worker — gathers social data and stores it in BigQuery + GCS.

Usage:
    python -m workers.collection.worker <collection_id>
"""

import json
import logging
import sys

from config.settings import get_settings
from workers.collection.media_downloader import download_media
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
    seen_post_ids: set[str] = set()
    seen_channel_ids: set[str] = set()

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

            # Download media to GCS
            for post in new_posts:
                if post.media_urls:
                    post.media_refs = download_media(gcs, post, collection_id)

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

            total_posts += len(new_posts)
            fs.update_collection_status(
                collection_id, posts_collected=total_posts
            )
            logger.info("Collection %s: %d posts so far (%d dupes skipped)", collection_id, total_posts, len(batch.posts) - len(new_posts))

        fs.update_collection_status(collection_id, status="completed")
        logger.info("Collection %s completed: %d total posts", collection_id, total_posts)

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
