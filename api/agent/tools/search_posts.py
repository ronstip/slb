"""Search Posts Tool — keyword/regex search across post content.

Sharp-shaped wrapper around a single canonical SQL template so the agent
doesn't write `LIKE` clauses, joins, or engagement-dedup `QUALIFY` blocks
itself for the "find posts mentioning X" pattern. Replaces the variant-
prone `execute_sql` calls that were the worst offenders in the SQL-loop
pathology (different whitespace + column orderings of the same query).

This still hits BigQuery — the win is determinism (same inputs always
produce the same SQL, so the dedup callback catches loops) and lower
agent overhead (no SQL-syntax thinking).

Use ``execute_sql`` when you need aggregation, joins beyond posts +
enrichment + engagement, or any analytical query. Use ``search_posts``
ONLY for "show me posts that contain ...".
"""

import logging
import re
from typing import Any

from google.adk.tools import ToolContext

from api.deps import get_bq

logger = logging.getLogger(__name__)


# Hard cap on returned rows. Posts have long text fields, so 50 rows is
# already a few thousand tokens of content for the model to reason over.
_MAX_LIMIT = 50
_DEFAULT_LIMIT = 20

_VALID_PLATFORMS = {"tiktok", "instagram", "twitter", "reddit", "youtube", "facebook"}
_VALID_SENTIMENTS = {"positive", "neutral", "negative"}
_VALID_SORTS = {"recent", "engagement", "views"}


def search_posts(
    query: str,
    collection_ids: list[str],
    regex: bool = False,
    limit: int = _DEFAULT_LIMIT,
    platforms: list[str] | None = None,
    sentiment: str = "",
    since_days: int = 0,
    sort_by: str = "engagement",
    tool_context: ToolContext = None,
) -> dict:
    """Find posts whose content matches a string or regex pattern.

    WHEN TO USE: The user wants you to *find specific posts* by what they
    say. "Show me posts mentioning 'recall'", "find any complaints about
    shipping", "any posts using the phrase 'broken'". This tool runs ONE
    deterministic SQL query under the hood; the dedup callback catches
    repeat calls with identical args.

    WHEN NOT TO USE:
      - You need *counts* or *aggregations* (how many, what %, top by …) →
        use ``execute_sql`` for those.
      - You need a join to channels, custom_fields, or a window function →
        use ``execute_sql``.
      - You only need an overview, not specific posts → use
        ``get_collection_stats``.
      - You need to filter by an absolute date or a date range — e.g.
        "posts from before 2020", "posts in March", "posts between X
        and Y" → use ``execute_sql`` with a ``WHERE p.posted_at`` clause.
        ``since_days`` here only covers "last N days from now"; it cannot
        bound the upper end of the range, so don't reach for
        ``query=".*"`` + ``since_days`` to fake it.

    Args:
        query: Search string. Plain-text by default (case-insensitive
            substring match). Pipe-separate alternatives like
            ``"recall|defective|broken"`` to OR them. Set ``regex=True`` to
            interpret as a BigQuery RE2 regular expression instead.
        collection_ids: Collections to search across. Required.
        regex: If True, treat ``query`` as a RE2 regex. Otherwise it's
            lowercased and used as a substring (with ``|`` understood as
            OR — internally turned into a regex of escaped alternatives).
        limit: Max rows to return. Capped at 50.
        platforms: Optional filter to specific platforms. Valid values:
            tiktok, instagram, twitter, reddit, youtube, facebook.
        sentiment: Optional filter — "positive" | "neutral" | "negative".
        since_days: Optional — only return posts from the last N days.
            0 (default) means no time filter.
        sort_by: "engagement" (default; views + likes), "recent"
            (posted_at DESC), or "views".
        tool_context: ADK tool context (injected automatically).

    Returns:
        ``{"status": "success", "rows": [...], "row_count": N, "query_pattern": str}``
        Each row has post_id, platform, channel_handle, posted_at, content,
        sentiment, ai_summary, likes, views, post_url. ``query_pattern`` is
        the regex that was actually used (useful for debugging).
    """
    # ── Validate inputs ──────────────────────────────────────────────────
    if not query or not query.strip():
        return {"status": "error", "message": "query is required and cannot be empty."}
    if not collection_ids:
        return {"status": "error", "message": "collection_ids is required."}

    limit = max(1, min(int(limit or _DEFAULT_LIMIT), _MAX_LIMIT))

    # Normalise platforms list — silently drop unknowns rather than erroring,
    # because a typo shouldn't kill the whole search; surface what was used.
    platforms_clean: list[str] = []
    if platforms:
        platforms_clean = [
            p.lower() for p in platforms if isinstance(p, str) and p.lower() in _VALID_PLATFORMS
        ]

    sentiment_clean = sentiment.lower() if sentiment else ""
    if sentiment_clean and sentiment_clean not in _VALID_SENTIMENTS:
        return {
            "status": "error",
            "message": f"sentiment must be one of {sorted(_VALID_SENTIMENTS)} or empty.",
        }

    sort_by_clean = (sort_by or "engagement").lower()
    if sort_by_clean not in _VALID_SORTS:
        sort_by_clean = "engagement"

    # ── Build the regex pattern ─────────────────────────────────────────
    if regex:
        pattern = query.strip()
        # Validate it compiles in Python — close enough to RE2 to catch obvious mistakes.
        try:
            re.compile(pattern)
        except re.error as e:
            return {
                "status": "error",
                "message": f"Invalid regex: {e}. Set regex=False or fix the pattern.",
            }
    else:
        # Plain-text: split on `|`, escape each alternative, then OR them.
        # Lowercase the input — the SQL also LOWERs the column.
        alternatives = [
            re.escape(alt.strip().lower())
            for alt in query.split("|")
            if alt.strip()
        ]
        if not alternatives:
            return {"status": "error", "message": "query has no usable terms after splitting on '|'."}
        pattern = "(" + "|".join(alternatives) + ")"

    # ── Build SQL ────────────────────────────────────────────────────────
    # Engagement dedup via QUALIFY — same canonical pattern used in the
    # shared prompt's SQL reference.
    where_extra: list[str] = []
    params: dict[str, Any] = {
        "collection_ids": collection_ids,
        "pattern": pattern,
        "limit": limit,
    }

    if platforms_clean:
        where_extra.append("p.platform IN UNNEST(@platforms)")
        params["platforms"] = platforms_clean

    if sentiment_clean:
        where_extra.append("ep.sentiment = @sentiment")
        params["sentiment"] = sentiment_clean

    if since_days and int(since_days) > 0:
        where_extra.append(
            "p.posted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @since_days DAY)"
        )
        params["since_days"] = int(since_days)

    # Agent-level data window — hard bounds set at agent creation, editable
    # in Settings → Sources. Cached in tool_context.state by set_active_agent
    # so we don't pay a Firestore read per search. End-date semantic is
    # inclusive of the entire UTC end day (TIMESTAMP_ADD ... + 1 DAY trick).
    state = tool_context.state if tool_context else {}
    data_start_date = state.get("active_agent_data_start_date")
    data_end_date = state.get("active_agent_data_end_date")
    if data_start_date:
        where_extra.append("p.posted_at >= TIMESTAMP(@data_start_date)")
        params["data_start_date"] = data_start_date
    if data_end_date:
        where_extra.append(
            "p.posted_at < TIMESTAMP_ADD(TIMESTAMP(@data_end_date), INTERVAL 1 DAY)"
        )
        params["data_end_date"] = data_end_date

    where_clause = (
        "p.collection_id IN UNNEST(@collection_ids)\n"
        "  AND ep.is_related_to_task = TRUE\n"
        "  AND REGEXP_CONTAINS(LOWER(COALESCE(p.content, p.title, '')), @pattern)"
    )
    if where_extra:
        where_clause += "\n  AND " + "\n  AND ".join(where_extra)

    if sort_by_clean == "recent":
        order_clause = "ORDER BY p.posted_at DESC NULLS LAST"
    elif sort_by_clean == "views":
        order_clause = "ORDER BY pe.views DESC NULLS LAST"
    else:  # engagement
        order_clause = (
            "ORDER BY (COALESCE(pe.views, 0) + COALESCE(pe.likes, 0)) DESC NULLS LAST"
        )

    sql = f"""
    WITH dedup_ep AS (
      SELECT * EXCEPT(_rn) FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY post_id
          ORDER BY agent_version DESC NULLS LAST, enriched_at DESC
        ) AS _rn
        FROM social_listening.enriched_posts
      ) WHERE _rn = 1
    )
    SELECT
      p.post_id,
      p.platform,
      p.channel_handle,
      p.posted_at,
      SUBSTR(COALESCE(p.content, p.title, ''), 1, 600) AS content,
      ep.sentiment,
      ep.ai_summary,
      pe.likes,
      pe.views,
      p.post_url
    FROM social_listening.posts p
    JOIN dedup_ep ep ON p.post_id = ep.post_id
    LEFT JOIN social_listening.post_engagements pe ON p.post_id = pe.post_id
    WHERE {where_clause}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY pe.fetched_at DESC) = 1
    {order_clause}
    LIMIT @limit
    """

    # ── Execute ─────────────────────────────────────────────────────────
    try:
        bq = get_bq()
        rows = bq.query(sql, params=params)
    except Exception as e:
        logger.exception("search_posts: query failed")
        return {
            "status": "error",
            "message": f"BigQuery query failed: {e}",
            "query_pattern": pattern,
        }

    return {
        "status": "success",
        "rows": rows,
        "row_count": len(rows),
        "query_pattern": pattern,
        "sort_by": sort_by_clean,
        "limit_applied": limit,
    }
