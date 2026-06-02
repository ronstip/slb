"""Comments Worker - fetches a post's full reply tree and appends to BQ.

Fire-and-forget, same shape as workers/engagement/worker.py.

Output:
    - social_listening.comments - one row per reply
    - social_listening.channels - one snapshot row per unique comment author

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

from api.services.cost_meter import EVENT_PROVIDER, log_cost
from config.cost_rates import normalize_provider
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


# Map external platform → cost-rate provider key. Adapter dispatch in
# `wrapper.fetch_comments` uses the platform label; cost attribution uses
# the canonical provider key from `config/cost_rates.py`.
_PLATFORM_PROVIDER: dict[str, str] = {
    "twitter": "x_api",
    "x": "x_api",
    # NOTE: Instagram intentionally not mapped here. Apify's adapter logs
    # cost from inside `_run_actor_collect_raw` via the provider-reported
    # `usageTotalUsd` field with feature="comments"; logging again here
    # would double-bill. X is units-based (PAYG search/all reads), so its
    # cost only surfaces when the comments worker emits it.
}


def fetch_post_comments(payload: dict) -> None:
    post_id = payload.get("post_id")
    platform = payload.get("platform")
    post_url = payload.get("post_url")
    collection_id = payload.get("collection_id")
    agent_id = payload.get("agent_id")
    user_id = payload.get("user_id")
    org_id = payload.get("org_id")
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

    # §E cost attribution - bill the comment fetch under the originating
    # agent + user. Pricing: each reply tweet returned is one "search post
    # read"; we also issue one root-tweet lookup to resolve the
    # conversation id, so units = len(comments) + 1. NULL cost when we
    # can't map the platform → a known provider (e.g. instagram comments,
    # if added later) - row still goes in so the admin sees the activity.
    provider = normalize_provider(payload.get("crawl_provider")) or _PLATFORM_PROVIDER.get(platform)
    if provider and user_id:
        units = len(batch.comments) + 1  # +1 = root-tweet lookup
        try:
            log_cost(
                provider=provider,
                user_id=user_id,
                org_id=org_id,
                feature="comments",
                event_type=EVENT_PROVIDER,
                sub_kind="search_per_post",
                platform=platform,
                units=units,
                unit_kind="posts",
                collection_id=collection_id,
                agent_id=agent_id,
            )
        except Exception:
            logger.warning(
                "comments worker: cost logging failed for post %s",
                post_id, exc_info=True,
            )


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
