"""Comments Worker — fetches a post's full reply tree and appends to BQ.

Fire-and-forget, same shape as workers/engagement/worker.py.

Output:
    - social_listening.comments — one row per reply
    - social_listening.channels — one snapshot row per unique comment author

Payload (from Cloud Task body):
    {
        "post_id": "...",
        "collection_id": "...",        # owning collection (for channels.collection_id)
        "agent_id": "...",             # triggering agent, optional
        "platform": "twitter",
        "post_url": "https://x.com/...",
        "crawl_provider": "xapi",      # optional; stamped on rows if absent in batch
    }
"""

import json
import logging
import sys

from config.settings import get_settings
from workers.collection.models import Channel
from workers.collection.normalizer import (
    channel_to_bq_row,
    comment_to_bq_row,
    seed_comment_media_refs,
)
from workers.collection.wrapper import DataProviderWrapper
from workers.shared.bq_client import BQClient

logger = logging.getLogger(__name__)


def fetch_post_comments(payload: dict) -> None:
    post_id = payload.get("post_id")
    platform = payload.get("platform")
    post_url = payload.get("post_url")
    collection_id = payload.get("collection_id")
    agent_id = payload.get("agent_id")
    if not post_id or not platform or not post_url:
        raise ValueError(
            "fetch_post_comments requires post_id, platform, post_url; got: "
            f"{ {k: payload.get(k) for k in ('post_id', 'platform', 'post_url')} }"
        )
    if not collection_id:
        raise ValueError("fetch_post_comments requires collection_id for channel registration")

    settings = get_settings()
    bq = BQClient(settings)
    wrapper = DataProviderWrapper(config={})

    logger.info("Fetching comments for post %s (platform=%s)", post_id, platform)

    batch = wrapper.fetch_comments(platform, {
        "post_id": post_id,
        "platform": platform,
        "post_url": post_url,
    })

    # Seed URL-only media_refs (no GCS download in v1).
    for c in batch.comments:
        seed_comment_media_refs(c)
        if not c.crawl_provider:
            c.crawl_provider = payload.get("crawl_provider") or platform

    # Dedup channels by (channel_id or channel_handle) within this batch.
    unique_channels: dict[str, Channel] = {}
    for ch in batch.channels:
        key = ch.channel_id or ch.channel_handle
        if key and key not in unique_channels:
            unique_channels[key] = ch
    if unique_channels:
        channel_rows = [channel_to_bq_row(ch, collection_id) for ch in unique_channels.values()]
        bq.insert_rows("channels", channel_rows)
        logger.info("Inserted %d channel snapshots for comment authors", len(channel_rows))

    if batch.comments:
        comment_rows = [comment_to_bq_row(c, post_id=post_id, agent_id=agent_id) for c in batch.comments]
        bq.insert_rows("comments", comment_rows)
        logger.info("Inserted %d comments for post %s", len(comment_rows), post_id)
    else:
        logger.info("No comments fetched for post %s", post_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if len(sys.argv) < 2:
        print(
            'Usage: python -m workers.comments.worker '
            "'{\"post_id\": \"...\", \"collection_id\": \"...\", "
            "\"platform\": \"twitter\", \"post_url\": \"https://x.com/...\"}'"
        )
        sys.exit(1)
    fetch_post_comments(json.loads(sys.argv[1]))
