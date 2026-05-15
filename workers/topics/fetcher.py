"""Fetch posts for topic taxonomy — TVF-based, agent-scoped, window-filtered.

The `scope_posts` table function already handles per-post dedup, the
is_related_to_task filter, and the agent's data_start_date floor. We just
add the recency window and optional collection filter in the WHERE clause.

Window fallback widens the time window only — never disables the relevance
filter (different from brothers_v1 which had a "tier 4: any enrichment state"
escape hatch). The new algorithm relies on relevance being correct because
the LLM passes are sample-driven; pulling in irrelevant posts pollutes the
taxonomy.
"""

import logging
from typing import Any

from workers.shared.bq_client import BQClient

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_FALLBACK_DAYS = [7, 30, 90, None]  # None = unbounded
MIN_USABLE_POSTS = 10  # below this we widen the window


_FETCH_SQL_WITH_WINDOW = """
SELECT
  post_id, ai_summary, themes, entities, detected_brands,
  content_type, custom_fields,
  platform, channel_type, channel_handle, channel_id,
  COALESCE(likes, 0) AS likes,
  COALESCE(comments_count, 0) AS comments_count,
  COALESCE(views, 0) AS views,
  COALESCE(shares, 0) AS shares,
  COALESCE(saves, 0) AS saves,
  posted_at, collection_id, language, sentiment
FROM social_listening.scope_posts(@agent_id)
WHERE posted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @window_days DAY)
  {collection_clause}
"""

_FETCH_SQL_UNBOUNDED = """
SELECT
  post_id, ai_summary, themes, entities, detected_brands,
  content_type, custom_fields,
  platform, channel_type, channel_handle, channel_id,
  COALESCE(likes, 0) AS likes,
  COALESCE(comments_count, 0) AS comments_count,
  COALESCE(views, 0) AS views,
  COALESCE(shares, 0) AS shares,
  COALESCE(saves, 0) AS saves,
  posted_at, collection_id, language, sentiment
FROM social_listening.scope_posts(@agent_id)
WHERE TRUE
  {collection_clause}
"""


def fetch_posts_for_taxonomy(
    bq: BQClient,
    agent_id: str,
    window_days: int = 7,
    collection_ids: list[str] | None = None,
    fallback_widening: list[int | None] | None = None,
    min_usable_posts: int = MIN_USABLE_POSTS,
) -> tuple[list[dict[str, Any]], int | None]:
    """Fetch agent-scoped, relevant posts in a recency window.

    Returns (posts, effective_window_days). `effective_window_days` is None
    when the unbounded fallback was used.

    Strategy: try the caller's requested window first; if too few posts,
    widen progressively. Widening list defaults to [requested, 30, 90, None]
    deduped, but the caller can override.
    """
    if fallback_widening is None:
        # Start with the caller's request, then widen.
        tiers = [window_days]
        for w in DEFAULT_WINDOW_FALLBACK_DAYS:
            if w is None:
                tiers.append(None)
            elif w > window_days:
                tiers.append(w)
        # Dedupe preserving order
        seen = set()
        deduped = []
        for t in tiers:
            key = "unbounded" if t is None else t
            if key not in seen:
                seen.add(key)
                deduped.append(t)
        tiers = deduped
    else:
        tiers = fallback_widening

    collection_clause = ""
    params: dict[str, Any] = {"agent_id": agent_id}
    if collection_ids:
        collection_clause = "AND collection_id IN UNNEST(@collection_ids)"
        params["collection_ids"] = collection_ids

    for tier_window in tiers:
        if tier_window is None:
            sql = _FETCH_SQL_UNBOUNDED.format(collection_clause=collection_clause)
            tier_params = dict(params)
        else:
            sql = _FETCH_SQL_WITH_WINDOW.format(collection_clause=collection_clause)
            tier_params = dict(params, window_days=tier_window)

        rows = bq.query(sql, tier_params)
        logger.info(
            "Topics fetch: window=%s collections=%s -> %d posts",
            "unbounded" if tier_window is None else f"{tier_window}d",
            len(collection_ids) if collection_ids else "all",
            len(rows),
        )
        if len(rows) >= min_usable_posts:
            return rows, tier_window

    # Return the last tier's rows even if below threshold — caller decides
    # whether to proceed.
    return rows, tier_window
