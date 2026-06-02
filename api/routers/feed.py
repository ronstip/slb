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
    # Fan out the per-collection Firestore reads in parallel - the previous
    # sequential loop blocked the asyncio loop and added one round-trip per
    # collection (4 collections = 4× the validation latency).
    statuses = await asyncio.gather(
        *(asyncio.to_thread(fs.get_collection_status, cid) for cid in request.collection_ids)
    )
    for cid, status in zip(request.collection_ids, statuses):
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()

    if request.agent_id:
        multi_sql, params = _build_tvf_sql(request)
    else:
        multi_sql, params = _build_legacy_sql(request)

    rows = await asyncio.to_thread(bq.query, multi_sql, params)
    total = rows[0]["_total"] if rows else 0
    total_views = rows[0]["_total_views"] if rows else 0
    total_sources = rows[0]["_total_sources"] if rows else 0

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

        # Skip rows with missing post_id - corrupted ingestion can produce
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
                language=row.get("language"),
                custom_fields=row.get("custom_fields") if isinstance(row.get("custom_fields"), dict) else None,
                context=row.get("context"),
                detected_brands=row.get("detected_brands") if isinstance(row.get("detected_brands"), list) else [],
                channel_type=row.get("channel_type"),
                collection_id=row.get("collection_id"),
                is_retweet=row.get("is_retweet"),
                is_quote=row.get("is_quote"),
            )
        )

    return FeedResponse(
        posts=posts,
        total=int(total),
        total_views=int(total_views or 0),
        total_sources=int(total_sources or 0),
        offset=request.offset,
        limit=request.limit,
    )


_SORT_MAP_TVF = {
    "engagement": "COALESCE(likes, 0) + COALESCE(comments_count, 0) + COALESCE(views, 0) DESC",
    "recent": "posted_at DESC",
    "sentiment": "sentiment ASC, posted_at DESC",
    "views": "COALESCE(views, 0) DESC, posted_at DESC",
}

_SORT_MAP_LEGACY = {
    "engagement": "COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) DESC",
    "recent": "p.posted_at DESC",
    "sentiment": "ep.sentiment ASC, p.posted_at DESC",
    "views": "COALESCE(pe.views, 0) DESC, p.posted_at DESC",
}


def _build_tvf_sql(request: MultiFeedRequest) -> tuple[str, dict]:
    """Build the agent-aware feed query that delegates scoping to scope_posts TVF."""
    params: dict = {
        "agent_id": request.agent_id,
        "collection_ids": request.collection_ids,
        "limit": request.limit,
        "offset": request.offset,
    }

    where_clauses: list[str] = ["base.collection_id IN UNNEST(@collection_ids)"]

    if request.start_date:
        where_clauses.append("base.posted_at >= TIMESTAMP(@start_date)")
        params["start_date"] = request.start_date

    if request.end_date:
        # Inclusive of the entire end day in UTC (see legacy comment).
        where_clauses.append(
            "base.posted_at < TIMESTAMP_ADD(TIMESTAMP(@end_date), INTERVAL 1 DAY)"
        )
        params["end_date"] = request.end_date

    if request.platform != "all":
        where_clauses.append("base.platform = @platform")
        params["platform"] = request.platform

    if request.sentiment != "all":
        where_clauses.append("base.sentiment = @sentiment")
        params["sentiment"] = request.sentiment

    if request.has_media:
        where_clauses.append(
            "(TO_JSON_STRING(base.media_refs) LIKE '%\"gs://%' "
            "OR TO_JSON_STRING(base.media_refs) LIKE '%\"original_url\":\"http%')"
        )

    topic_join_sql = ""
    if request.topic_cluster_id:
        topic_join_sql = """
        JOIN (
            SELECT post_id
            FROM social_listening.topic_clusters tc, UNNEST(tc.member_post_ids) as post_id
            WHERE tc.cluster_id = @topic_cluster_id
              AND tc.clustered_at = (
                  SELECT MAX(clustered_at)
                  FROM social_listening.topic_clusters
                  WHERE cluster_id = @topic_cluster_id
              )
        ) tcm USING (post_id)
        """
        params["topic_cluster_id"] = request.topic_cluster_id

    where_sql = "WHERE " + " AND ".join(where_clauses)
    order_sql = _SORT_MAP_TVF.get(request.sort, _SORT_MAP_TVF["views"])

    sql = f"""
    WITH base AS (
      SELECT * FROM social_listening.scope_posts(@agent_id)
    )
    SELECT
        base.post_id, base.platform, base.channel_handle, base.channel_id,
        base.title, base.content, base.post_url, base.posted_at, base.post_type, base.media_refs,
        base.collection_id,
        COALESCE(base.likes, 0) AS likes,
        COALESCE(base.shares, 0) AS shares,
        COALESCE(base.views, 0) AS views,
        COALESCE(base.comments_count, 0) AS comments_count,
        COALESCE(base.saves, 0) AS saves,
        COALESCE(base.likes, 0) + COALESCE(base.comments_count, 0) + COALESCE(base.views, 0) AS total_engagement,
        base.sentiment, base.emotion, base.themes, base.entities, base.ai_summary,
        base.content_type, base.language, base.custom_fields,
        base.context, base.detected_brands, base.channel_type,
        base.is_retweet, base.is_quote,
        COUNT(*) OVER() AS _total,
        SUM(COALESCE(base.views, 0)) OVER() AS _total_views,
        COUNT(DISTINCT base.platform) OVER() AS _total_sources
    FROM base
    {topic_join_sql}
    {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """
    return sql, params


def _build_legacy_sql(request: MultiFeedRequest) -> tuple[str, dict]:
    """Build the non-agent-scoped feed query (back-compat for callers without agent_id).

    Picks the latest enrichment per post by enriched_at, regardless of agent_id -
    so it can show posts enriched by legacy / cross-agent runs. Use the TVF path
    (pass agent_id) when you want this agent's view of the data.
    """
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

    if request.start_date:
        where_clauses.append("p.posted_at >= TIMESTAMP(@start_date)")
        params["start_date"] = request.start_date

    if request.end_date:
        # Inclusive of the entire end day in UTC: a YYYY-MM-DD value casts
        # to midnight UTC, so use < next-day rather than <= midnight to avoid
        # silently dropping every post from the end date itself.
        where_clauses.append(
            "p.posted_at < TIMESTAMP_ADD(TIMESTAMP(@end_date), INTERVAL 1 DAY)"
        )
        params["end_date"] = request.end_date

    if request.has_media:
        where_clauses.append(
            "(TO_JSON_STRING(p.media_refs) LIKE '%\"gs://%' "
            "OR TO_JSON_STRING(p.media_refs) LIKE '%\"original_url\":\"http%')"
        )

    topic_join_sql = ""
    if request.topic_cluster_id:
        topic_join_sql = """
        JOIN (
            SELECT post_id
            FROM social_listening.topic_clusters tc, UNNEST(tc.member_post_ids) as post_id
            WHERE tc.cluster_id = @topic_cluster_id
              AND tc.clustered_at = (
                  SELECT MAX(clustered_at)
                  FROM social_listening.topic_clusters
                  WHERE cluster_id = @topic_cluster_id
              )
        ) tcm USING (post_id)
        """
        params["topic_cluster_id"] = request.topic_cluster_id

    where_sql = " AND ".join(where_clauses)
    order_sql = _SORT_MAP_LEGACY.get(request.sort, _SORT_MAP_LEGACY["views"])

    params["limit"] = request.limit
    params["offset"] = request.offset

    sql = f"""
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
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.language, ep.custom_fields,
        ep.context, ep.detected_brands, ep.channel_type,
        SAFE_CAST(JSON_VALUE(p.platform_metadata, '$.is_retweet') AS BOOL) as is_retweet,
        SAFE_CAST(JSON_VALUE(p.platform_metadata, '$.is_quote_status') AS BOOL) as is_quote,
        COUNT(*) OVER() as _total,
        SUM(COALESCE(pe.views, 0)) OVER() as _total_views,
        COUNT(DISTINCT p.platform) OVER() as _total_sources
    FROM {posts_subquery} p
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (
                   PARTITION BY post_id
                   ORDER BY (source = 'user_override') DESC, enriched_at DESC
               ) AS _rn
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
    return sql, params
