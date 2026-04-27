"""Unified multi-collection feed (POST /feed)."""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.requests import MultiFeedRequest
from api.schemas.responses import FeedPostResponse, FeedResponse
from api.services.collection_service import can_access_collection

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feed", response_model=FeedResponse)
async def get_multi_collection_feed(
    request: MultiFeedRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Unified feed across multiple collections, sorted by views desc."""
    if not request.collection_ids:
        return FeedResponse(posts=[], total=0, offset=request.offset, limit=request.limit)

    fs = get_fs()
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()

    # Dedup within collection, then across collections by post_id.
    # Time-range gate joins social_listening.collections so posts outside
    # the agent's configured window are excluded — single source of truth.
    posts_subquery = """(
        SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
            FROM (
                SELECT pp.*, ROW_NUMBER() OVER (PARTITION BY pp.collection_id, pp.post_id ORDER BY pp.collected_at DESC) AS _rn
                FROM social_listening.posts pp
                JOIN social_listening.collections cc USING (collection_id)
                WHERE pp.posted_at BETWEEN COALESCE(cc.time_range_start, TIMESTAMP('2000-01-01')) AND COALESCE(cc.time_range_end, CURRENT_TIMESTAMP())
            ) sub
            WHERE _rn = 1
        ) deduped
        WHERE _dedup_rn = 1
    )"""

    where_clauses = ["p.collection_id IN UNNEST(@collection_ids)"]
    params: dict = {"collection_ids": request.collection_ids}

    if request.platform != "all":
        where_clauses.append("p.platform = @platform")
        params["platform"] = request.platform

    if request.sentiment != "all":
        where_clauses.append("ep.sentiment = @sentiment")
        params["sentiment"] = request.sentiment

    if request.relevant_to_task == "true":
        where_clauses.append("ep.is_related_to_task = TRUE")
    elif request.relevant_to_task == "false":
        where_clauses.append("ep.is_related_to_task = FALSE")

    if request.has_media:
        # Posts where at least one media_ref has a usable URL (GCS URI or valid original URL)
        where_clauses.append(
            "(TO_JSON_STRING(p.media_refs) LIKE '%\"gs://%' "
            "OR TO_JSON_STRING(p.media_refs) LIKE '%\"original_url\":\"http%')"
        )

    topic_join_sql = ""
    if request.topic_cluster_id:
        topic_join_sql = """
        JOIN social_listening.topic_cluster_members tcm
          ON p.post_id = tcm.post_id
          AND tcm.collection_id = p.collection_id
          AND tcm.cluster_id = @topic_cluster_id
          AND tcm.clustered_at = (
              SELECT MAX(clustered_at)
              FROM social_listening.topic_cluster_members
              WHERE collection_id = p.collection_id
          )
        """
        params["topic_cluster_id"] = request.topic_cluster_id

    where_sql = " AND ".join(where_clauses)

    sort_map = {
        "engagement": "COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) DESC",
        "recent": "p.posted_at DESC",
        "sentiment": "ep.sentiment ASC, p.posted_at DESC",
        "views": "COALESCE(pe.views, 0) DESC, p.posted_at DESC",
    }
    order_sql = sort_map.get(request.sort, sort_map["views"])

    params["limit"] = request.limit
    params["offset"] = request.offset

    multi_sql = f"""
    SELECT
        p.post_id, p.platform, p.channel_handle, p.channel_id,
        p.title, p.content, p.post_url, p.posted_at, p.post_type, p.media_refs,
        p.collection_id,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) as total_engagement,
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.custom_fields,
        ep.context, ep.is_related_to_task, ep.detected_brands, ep.channel_type,
        COUNT(*) OVER() as _total
    FROM {posts_subquery} p
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    {topic_join_sql}
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """

    rows = await asyncio.to_thread(bq.query, multi_sql, params)
    total = rows[0]["_total"] if rows else 0

    posts = []
    for row in rows:
        themes = row.get("themes")
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except (json.JSONDecodeError, TypeError):
                themes = []

        entities = row.get("entities")
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except (json.JSONDecodeError, TypeError):
                entities = []

        media_refs = row.get("media_refs")
        if isinstance(media_refs, str):
            try:
                media_refs = json.loads(media_refs)
            except (json.JSONDecodeError, TypeError):
                media_refs = []

        # Skip rows with missing post_id — corrupted ingestion can produce
        # rows with null ids and non-null string fields that fail the
        # response model.
        if not row.get("post_id"):
            continue

        posts.append(
            FeedPostResponse(
                post_id=row["post_id"],
                platform=row["platform"],
                channel_handle=row.get("channel_handle") or "",
                channel_id=row.get("channel_id"),
                title=row.get("title"),
                content=row.get("content"),
                post_url=row.get("post_url") or "",
                posted_at=str(row.get("posted_at") or ""),
                post_type=row.get("post_type") or "",
                media_refs=media_refs if isinstance(media_refs, list) else [],
                likes=row.get("likes", 0),
                shares=row.get("shares", 0),
                views=row.get("views", 0),
                comments_count=row.get("comments_count", 0),
                saves=row.get("saves", 0),
                total_engagement=row.get("total_engagement", 0),
                sentiment=row.get("sentiment"),
                emotion=row.get("emotion"),
                themes=themes if isinstance(themes, list) else [],
                entities=entities if isinstance(entities, list) else [],
                ai_summary=row.get("ai_summary"),
                content_type=row.get("content_type"),
                custom_fields=row.get("custom_fields") if isinstance(row.get("custom_fields"), dict) else None,
                context=row.get("context"),
                is_related_to_task=row.get("is_related_to_task"),
                detected_brands=row.get("detected_brands") if isinstance(row.get("detected_brands"), list) else [],
                channel_type=row.get("channel_type"),
                collection_id=row.get("collection_id"),
            )
        )

    return FeedResponse(posts=posts, total=int(total), offset=request.offset, limit=request.limit)
