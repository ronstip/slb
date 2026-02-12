"""Engagement Worker — re-fetches metrics + comments and appends snapshots.

Usage:
    python -m workers.engagement.worker '{"input_type": "collection_id", "collection_id": "..."}'
    python -m workers.engagement.worker '{"input_type": "post_ids", "post_ids": [...]}'
"""

import json
import logging
import sys
from itertools import groupby
from operator import itemgetter
from uuid import uuid4

from config.settings import get_settings
from workers.collection.wrapper import DataProviderWrapper
from workers.shared.bq_client import BQClient

logger = logging.getLogger(__name__)


def _resolve_posts(bq: BQClient, payload: dict) -> list[dict]:
    """Resolve posts from payload into list of {post_id, platform, post_url}."""
    input_type = payload.get("input_type")

    if input_type == "collection_id":
        return bq.query(
            "SELECT post_id, platform, post_url FROM social_listening.posts "
            "WHERE collection_id = @collection_id",
            {"collection_id": payload["collection_id"]},
        )
    elif input_type == "post_ids":
        # BQ doesn't support array params easily, so query in batches
        post_ids = payload["post_ids"]
        all_posts = []
        for i in range(0, len(post_ids), 100):
            batch_ids = post_ids[i : i + 100]
            id_list = ", ".join(f"'{pid}'" for pid in batch_ids)
            all_posts.extend(
                bq.query(
                    f"SELECT post_id, platform, post_url FROM social_listening.posts "
                    f"WHERE post_id IN ({id_list})"
                )
            )
        return all_posts
    else:
        raise ValueError(f"Unknown input_type: {input_type}")


def refresh_engagements(payload: dict) -> None:
    settings = get_settings()
    bq = BQClient(settings)
    wrapper = DataProviderWrapper(config={})

    posts = _resolve_posts(bq, payload)
    if not posts:
        logger.info("No posts to refresh")
        return

    logger.info("Refreshing engagements for %d posts", len(posts))

    # Group by platform
    sorted_posts = sorted(posts, key=itemgetter("platform"))
    for platform, group in groupby(sorted_posts, key=itemgetter("platform")):
        group_list = list(group)
        post_urls = [p["post_url"] for p in group_list]
        post_id_map = {p["post_url"]: p["post_id"] for p in group_list}

        results = wrapper.fetch_engagements(platform, post_urls)

        rows = []
        for r in results:
            post_id = post_id_map.get(r.get("post_url"))
            if not post_id:
                continue
            rows.append(
                {
                    "engagement_id": str(uuid4()),
                    "post_id": post_id,
                    "likes": r.get("likes"),
                    "shares": r.get("shares"),
                    "comments_count": r.get("comments_count"),
                    "views": r.get("views"),
                    "saves": r.get("saves"),
                    "comments": json.dumps(r.get("comments", [])),
                    "platform_engagements": None,
                    "source": "refresh",
                }
            )

        if rows:
            bq.insert_rows("post_engagements", rows)
            logger.info("Inserted %d engagement snapshots for %s", len(rows), platform)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if len(sys.argv) < 2:
        print('Usage: python -m workers.engagement.worker \'{"input_type": "collection_id", "collection_id": "..."}\'')
        sys.exit(1)

    payload = json.loads(sys.argv[1])
    refresh_engagements(payload)
