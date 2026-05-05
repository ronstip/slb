"""Shared dashboard data-fetching logic used by both authenticated and public endpoints.

Dashboard reads always go through the `social_listening.scope_posts` TVF —
the same single source of truth used by `/feed`, the data tab, topics,
briefings, and the agent's overview/live feed. The TVF dedups posts, picks
*this* agent's enrichment row (skipping NULL-agent legacy and other agents'
rows), and joins the latest engagement.

`agent_id` is required. Callers that don't have one in hand should derive it
from the collections via :func:`derive_agent_id_for_collections`. When no
agent context is recoverable (collections never linked to any agent), the
builders return ``(None, None)`` — callers should skip BigQuery and serve an
empty result.
"""

import json
import logging

from api.schemas.responses import DashboardPostResponse

logger = logging.getLogger(__name__)

MAX_ROWS = 5000


def derive_agent_id_for_collections(fs, collection_ids: list[str]) -> str | None:
    """Look up the agent_id for a set of collections in Firestore.

    Each collection's status doc carries `agent_id` (set when the agent's run
    creates the collection — see services/agent_service.py). We use that to
    resolve the dashboard's agent context when the request didn't carry one.

    Returns the most-common agent_id across the collections (multi-agent
    dashboards are rare; we pick a consistent view). Returns None when no
    collection has an agent_id — those collections are orphan and not
    queryable through the agent-scoped dashboard.
    """
    if not collection_ids:
        return None

    counts: dict[str, int] = {}
    for cid in collection_ids:
        try:
            status = fs.get_collection_status(cid)
        except Exception:  # noqa: BLE001 — telemetry-style lookup, never block
            logger.exception("Failed reading collection_status for %s", cid)
            continue
        if not status:
            continue
        aid = status.get("agent_id")
        if aid:
            counts[aid] = counts.get(aid, 0) + 1

    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


COLLECTION_NAMES_SQL = """
SELECT collection_id, original_question
FROM social_listening.collections
WHERE collection_id IN UNNEST(@collection_ids)
"""


# ─── TVF-backed SQL builders ────────────────────────────────────────


def build_dashboard_sql(
    collection_ids: list[str],
    agent_id: str | None,
    max_rows: int,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the dashboard rows query, or (None, None) when
    no agent context is recoverable. Always TVF-scoped — the legacy cross-agent
    SQL has been retired in favor of a single source of truth.
    """
    if not agent_id:
        return None, None

    sql = f"""
    SELECT
        post_id,
        collection_id,
        platform,
        channel_handle,
        posted_at,
        title,
        content,
        post_url,
        sentiment,
        emotion,
        themes,
        entities,
        language,
        content_type,
        custom_fields,
        ai_summary,
        context,
        detected_brands,
        channel_type,
        media_refs,
        COALESCE(likes, 0) AS like_count,
        COALESCE(views, 0) AS view_count,
        COALESCE(comments_count, 0) AS comment_count,
        COALESCE(shares, 0) AS share_count
    FROM social_listening.scope_posts(@agent_id)
    WHERE collection_id IN UNNEST(@collection_ids)
    LIMIT {max_rows}
    """
    return sql, {"agent_id": agent_id, "collection_ids": collection_ids}


def build_dashboard_kpis_sql(
    collection_ids: list[str],
    agent_id: str | None,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the dashboard KPI aggregates, or (None, None)
    when no agent context is recoverable.
    """
    if not agent_id:
        return None, None

    sql = """
    SELECT
        COUNT(*) AS total_posts,
        COALESCE(SUM(COALESCE(views, 0)), 0) AS total_views,
        COALESCE(SUM(COALESCE(likes, 0)), 0) AS total_likes,
        COALESCE(SUM(COALESCE(comments_count, 0)), 0) AS total_comments,
        COALESCE(SUM(COALESCE(shares, 0)), 0) AS total_shares
    FROM social_listening.scope_posts(@agent_id)
    WHERE collection_id IN UNNEST(@collection_ids)
    """
    return sql, {"agent_id": agent_id, "collection_ids": collection_ids}


# ─── Field parsing helpers ──────────────────────────────────────────


def _parse_custom_fields(value) -> dict | None:
    if isinstance(value, dict):
        return value or None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) and parsed else None
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def parse_json_field(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _serialize_media_refs(value) -> str | None:
    """Return media_refs as a JSON string (or None)."""
    if not value:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        return None


def build_post_response(row: dict) -> DashboardPostResponse:
    return DashboardPostResponse(
        post_id=row["post_id"],
        collection_id=row["collection_id"],
        platform=row["platform"],
        channel_handle=row.get("channel_handle") or "",
        posted_at=str(row.get("posted_at") or ""),
        title=row.get("title"),
        content=row.get("content"),
        post_url=row.get("post_url") or "",
        sentiment=row.get("sentiment"),
        emotion=row.get("emotion"),
        themes=parse_json_field(row.get("themes")),
        entities=parse_json_field(row.get("entities")),
        language=row.get("language"),
        content_type=row.get("content_type"),
        custom_fields=_parse_custom_fields(row.get("custom_fields")),
        like_count=row.get("like_count", 0),
        view_count=row.get("view_count", 0),
        comment_count=row.get("comment_count", 0),
        share_count=row.get("share_count", 0),
        ai_summary=row.get("ai_summary"),
        context=row.get("context"),
        detected_brands=parse_json_field(row.get("detected_brands")),
        channel_type=row.get("channel_type"),
        media_refs=_serialize_media_refs(row.get("media_refs")),
    )
