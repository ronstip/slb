"""Dashboard router — serves denormalized post data for client-side interactive dashboards."""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.requests import DashboardDataRequest
from api.schemas.responses import DashboardPostResponse, DashboardDataResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

MAX_ROWS = 5000

_DASHBOARD_SQL = """
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
    ep.key_quotes,
    COALESCE(pe.likes, 0) AS like_count,
    COALESCE(pe.views, 0) AS view_count,
    COALESCE(pe.comments_count, 0) AS comment_count,
    COALESCE(pe.shares, 0) AS share_count
FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
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

_COLLECTION_NAMES_SQL = """
SELECT collection_id, original_question
FROM social_listening.collections
WHERE collection_id IN UNNEST(@collection_ids)
"""


def _can_access_collection(user: CurrentUser, status: dict) -> bool:
    if status.get("user_id") == user.uid:
        return True
    if (
        user.org_id
        and status.get("org_id") == user.org_id
        and status.get("visibility") == "org"
    ):
        return True
    return False


def _parse_json_field(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    return []


@router.post("/data", response_model=DashboardDataResponse)
async def get_dashboard_data(
    request: DashboardDataRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Fetch all posts (denormalized) for client-side dashboard filtering."""
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="collection_ids is required")

    fs = get_fs()

    # Validate access for each collection
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()
    params = {"collection_ids": request.collection_ids}

    # Fetch posts + collection names in parallel
    sql = _DASHBOARD_SQL.format(max_rows=MAX_ROWS + 1)  # +1 to detect truncation

    rows, name_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, sql, params),
        asyncio.to_thread(bq.query, _COLLECTION_NAMES_SQL, params),
    )

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]

    collection_names = {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }

    posts = [
        DashboardPostResponse(
            post_id=row["post_id"],
            collection_id=row["collection_id"],
            platform=row["platform"],
            channel_handle=row.get("channel_handle", ""),
            posted_at=str(row.get("posted_at", "")),
            title=row.get("title"),
            content=row.get("content"),
            sentiment=row.get("sentiment"),
            emotion=row.get("emotion"),
            themes=_parse_json_field(row.get("themes")),
            entities=_parse_json_field(row.get("entities")),
            language=row.get("language"),
            content_type=row.get("content_type"),
            key_quotes=_parse_json_field(row.get("key_quotes")),
            like_count=row.get("like_count", 0),
            view_count=row.get("view_count", 0),
            comment_count=row.get("comment_count", 0),
            share_count=row.get("share_count", 0),
        )
        for row in rows
    ]

    return DashboardDataResponse(
        posts=posts,
        collection_names=collection_names,
        truncated=truncated,
    )
