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
    ep.sentiment,
    ep.emotion,
    ep.themes,
    ep.entities,
    ep.language,
    ep.content_type,
    COALESCE(pe.likes, 0) AS like_count,
    COALESCE(pe.views, 0) AS view_count,
    COALESCE(pe.comments_count, 0) AS comment_count,
    COALESCE(pe.shares, 0) AS share_count
FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
    FROM social_listening.posts
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
WHERE p.collection_id IN UNNEST(@collection_ids) AND p._rn = 1
LIMIT {max_rows}
"""

COLLECTION_NAMES_SQL = """
SELECT collection_id, original_question
FROM social_listening.collections
WHERE collection_id IN UNNEST(@collection_ids)
"""


def parse_json_field(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def build_post_response(row: dict) -> DashboardPostResponse:
    return DashboardPostResponse(
        post_id=row["post_id"],
        collection_id=row["collection_id"],
        platform=row["platform"],
        channel_handle=row.get("channel_handle", ""),
        posted_at=str(row.get("posted_at", "")),
        title=row.get("title"),
        content=row.get("content"),
        sentiment=row.get("sentiment"),
        emotion=row.get("emotion"),
        themes=parse_json_field(row.get("themes")),
        entities=parse_json_field(row.get("entities")),
        language=row.get("language"),
        content_type=row.get("content_type"),
        like_count=row.get("like_count", 0),
        view_count=row.get("view_count", 0),
        comment_count=row.get("comment_count", 0),
        share_count=row.get("share_count", 0),
    )
