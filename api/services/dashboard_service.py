"""Shared dashboard data-fetching logic used by both authenticated and public endpoints."""

import json

from api.schemas.responses import DashboardPostResponse

MAX_ROWS = 5000

DASHBOARD_SQL = """
SELECT
    p.post_id,
    p.collection_id,
    p.platform,
    p.channel_handle,
    p.posted_at,
    p.title,
    p.content,
    p.post_url,
    ep.sentiment,
    ep.emotion,
    ep.themes,
    ep.entities,
    ep.language,
    ep.content_type,
    ep.custom_fields,
    ep.ai_summary,
    ep.context,
    ep.is_related_to_task,
    ep.detected_brands,
    ep.channel_type,
    p.media_refs,
    COALESCE(pe.likes, 0) AS like_count,
    COALESCE(pe.views, 0) AS view_count,
    COALESCE(pe.comments_count, 0) AS comment_count,
    COALESCE(pe.shares, 0) AS share_count
FROM (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT pp.*,
                   ROW_NUMBER() OVER (PARTITION BY pp.collection_id, pp.post_id ORDER BY pp.collected_at DESC) AS _rn
            FROM social_listening.posts pp
            JOIN social_listening.collections cc USING (collection_id)
            WHERE pp.posted_at BETWEEN COALESCE(cc.time_range_start, TIMESTAMP('2000-01-01')) AND COALESCE(cc.time_range_end, CURRENT_TIMESTAMP())
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
) p
LEFT JOIN (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
    FROM social_listening.enriched_posts
) ep ON p.post_id = ep.post_id AND ep._rn = 1
LEFT JOIN (
    SELECT post_id, likes, shares, comments_count, views,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
) pe ON p.post_id = pe.post_id AND pe.rn = 1
WHERE p.collection_id IN UNNEST(@collection_ids)
LIMIT {max_rows}
"""

DASHBOARD_KPIS_SQL = """
WITH deduped_posts AS (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT pp.*,
                   ROW_NUMBER() OVER (PARTITION BY pp.collection_id, pp.post_id ORDER BY pp.collected_at DESC) AS _rn
            FROM social_listening.posts pp
            JOIN social_listening.collections cc USING (collection_id)
            WHERE pp.posted_at BETWEEN COALESCE(cc.time_range_start, TIMESTAMP('2000-01-01')) AND COALESCE(cc.time_range_end, CURRENT_TIMESTAMP())
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
)
SELECT
    COUNT(*) AS total_posts,
    COALESCE(SUM(COALESCE(pe.views, 0)), 0) AS total_views,
    COALESCE(SUM(COALESCE(pe.likes, 0)), 0) AS total_likes,
    COALESCE(SUM(COALESCE(pe.comments_count, 0)), 0) AS total_comments,
    COALESCE(SUM(COALESCE(pe.shares, 0)), 0) AS total_shares
FROM deduped_posts p
LEFT JOIN (
    SELECT post_id, likes, shares, comments_count, views,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
) pe ON p.post_id = pe.post_id AND pe.rn = 1
WHERE p.collection_id IN UNNEST(@collection_ids)
"""

COLLECTION_NAMES_SQL = """
SELECT collection_id, original_question
FROM social_listening.collections
WHERE collection_id IN UNNEST(@collection_ids)
"""


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
        is_related_to_task=row.get("is_related_to_task"),
        detected_brands=parse_json_field(row.get("detected_brands")),
        channel_type=row.get("channel_type"),
        media_refs=_serialize_media_refs(row.get("media_refs")),
    )
