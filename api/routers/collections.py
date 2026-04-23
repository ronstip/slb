"""Collection CRUD, status reads, stats, CSV download, and paginated feed."""

import asyncio
import csv
import io
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.rate_limiting import limiter
from api.schemas.requests import CreateCollectionRequest, UpdateCollectionRequest
from api.schemas.responses import (
    CollectionStatsResponse,
    CollectionStatusResponse,
    FeedPostResponse,
    FeedResponse,
)
from api.services.collection_service import (
    can_access_collection,
    create_collection_from_request,
    signature_to_response,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/collections")
@limiter.limit("5/minute")
async def create_collection(
    request: Request,
    body: CreateCollectionRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a collection directly from the frontend modal (bypasses agent)."""
    result = create_collection_from_request(body, user_id=user.uid, org_id=user.org_id)
    return result


@router.post("/collection/{collection_id}/visibility")
async def set_collection_visibility(
    collection_id: str,
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Toggle collection visibility between 'private' and 'org'. Only the owner can change this."""
    visibility = request.get("visibility", "private")
    if visibility not in ("private", "org"):
        raise HTTPException(status_code=400, detail="Visibility must be 'private' or 'org'")

    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can change visibility")
    if not user.org_id:
        raise HTTPException(status_code=400, detail="You must be in an organization to share collections")

    await asyncio.to_thread(
        fs.update_collection_status, collection_id, visibility=visibility, org_id=user.org_id
    )
    return {"status": "updated", "visibility": visibility}


@router.patch("/collection/{collection_id}")
async def update_collection(
    collection_id: str,
    request: UpdateCollectionRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update collection metadata (title, visibility). Only the owner can update."""
    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can update")

    updates = {}
    if request.title is not None:
        updates["title"] = request.title
    if request.visibility is not None:
        if request.visibility not in ("private", "org"):
            raise HTTPException(status_code=400, detail="Visibility must be 'private' or 'org'")
        if request.visibility == "org" and not user.org_id:
            raise HTTPException(status_code=400, detail="You must be in an organization to share collections")
        updates["visibility"] = request.visibility
        if request.visibility == "org":
            updates["org_id"] = user.org_id

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await asyncio.to_thread(fs.update_collection_status, collection_id, **updates)
    return {"status": "updated"}


@router.delete("/collection/{collection_id}")
async def delete_collection(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Delete a collection. Only the owner can delete."""
    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can delete")

    await asyncio.to_thread(
        fs._db.collection("collection_status").document(collection_id).delete
    )
    return {"status": "deleted"}


@router.get("/collections")
async def list_collections(user: CurrentUser = Depends(get_current_user)):
    """List all collections for the authenticated user (own + org-shared)."""
    fs = get_fs()
    db = fs._db

    def _fetch_own() -> list:
        return list(
            db.collection("collection_status")
            .where("user_id", "==", user.uid)
            .stream()
        )

    def _fetch_org() -> list:
        return list(
            db.collection("collection_status")
            .where("org_id", "==", user.org_id)
            .stream()
        )

    seen_ids = set()

    if user.org_id:
        try:
            own_docs, org_docs = await asyncio.gather(
                asyncio.to_thread(_fetch_own),
                asyncio.to_thread(_fetch_org),
            )
            all_docs = list(own_docs)
            for doc in org_docs:
                data = doc.to_dict()
                if data.get("visibility") == "org":
                    all_docs.append(doc)
        except Exception as e:
            # Non-critical: show the user's own collections even if the
            # org-share query fails (e.g., missing index, transient error).
            logger.error("Org query failed: %s", e)
            all_docs = await asyncio.to_thread(_fetch_own)
    else:
        all_docs = await asyncio.to_thread(_fetch_own)

    collections = []
    for doc in all_docs:
        if doc.id in seen_ids:
            continue
        seen_ids.add(doc.id)
        data = doc.to_dict()
        created_at_raw = data.get("created_at")
        created_at_str = None
        for key in ("created_at", "updated_at", "last_run_at", "next_run_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
                if key == "created_at":
                    created_at_str = data[key]
        if created_at_str is None and isinstance(created_at_raw, str):
            created_at_str = created_at_raw

        collections.append(
            CollectionStatusResponse(
                collection_id=doc.id,
                status=data.get("status", "unknown"),
                posts_collected=data.get("posts_collected", 0),
                posts_enriched=data.get("posts_enriched", 0),
                total_views=data.get("total_views", 0),
                positive_pct=data.get("positive_pct"),
                error_message=data.get("error_message"),
                config=data.get("config"),
                created_at=created_at_str,
                visibility=data.get("visibility", "private"),
                user_id=data.get("user_id"),
            )
        )

    collections.sort(key=lambda c: c.created_at or "", reverse=True)
    return collections


@router.get("/collections/{collection_id}/posts", response_model=FeedResponse)
async def get_collection_posts(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
    sort: str = Query(default="engagement"),
    platform: str = Query(default="all"),
    sentiment: str = Query(default="all"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Paginated enriched posts for the Feed."""
    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()

    where_clauses = ["p.collection_id = @collection_id", "p._rn = 1"]
    params: dict = {"collection_id": collection_id}

    if platform != "all":
        where_clauses.append("p.platform = @platform")
        params["platform"] = platform

    if sentiment != "all":
        where_clauses.append("ep.sentiment = @sentiment")
        params["sentiment"] = sentiment

    where_sql = " AND ".join(where_clauses)

    sort_map = {
        "engagement": "COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) DESC",
        "recent": "p.posted_at DESC",
        "sentiment": "ep.sentiment ASC, p.posted_at DESC",
        "views": "COALESCE(pe.views, 0) DESC, p.posted_at DESC",
    }
    order_sql = sort_map.get(sort, sort_map["engagement"])

    # Single query with COUNT(*) OVER() to get total alongside results,
    # avoiding a second BigQuery job.
    params["limit"] = limit
    params["offset"] = offset

    main_sql = f"""
    SELECT
        p.post_id,
        p.platform,
        p.channel_handle,
        p.channel_id,
        p.title,
        p.content,
        p.post_url,
        p.posted_at,
        p.post_type,
        p.media_refs,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) as total_engagement,
        ep.sentiment,
        ep.emotion,
        ep.themes,
        ep.entities,
        ep.ai_summary,
        ep.content_type,
        ep.custom_fields,
        ep.context,
        ep.is_related_to_task,
        ep.detected_brands,
        ep.channel_type,
        COUNT(*) OVER() as _total
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
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """

    rows = await asyncio.to_thread(bq.query, main_sql, params)
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

        posts.append(
            FeedPostResponse(
                post_id=row["post_id"],
                platform=row["platform"],
                channel_handle=row.get("channel_handle", ""),
                channel_id=row.get("channel_id"),
                title=row.get("title"),
                content=row.get("content"),
                post_url=row.get("post_url", ""),
                posted_at=str(row.get("posted_at", "")),
                post_type=row.get("post_type", ""),
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
            )
        )

    return FeedResponse(posts=posts, total=int(total), offset=offset, limit=limit)


@router.get("/collection/{collection_id}", response_model=CollectionStatusResponse)
async def get_collection_status(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Read collection status from Firestore."""
    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    return CollectionStatusResponse(
        collection_id=collection_id,
        status=status.get("status", "unknown"),
        posts_collected=status.get("posts_collected", 0),
        posts_enriched=status.get("posts_enriched", 0),
        total_views=status.get("total_views", 0),
        positive_pct=status.get("positive_pct"),
        error_message=status.get("error_message"),
        config=status.get("config"),
        visibility=status.get("visibility", "private"),
        user_id=status.get("user_id"),
    )


@router.get("/collection/{collection_id}/stats", response_model=CollectionStatsResponse)
async def get_collection_stats(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return statistical signature — from Firestore cache if available, else compute fresh."""
    from api.services.statistical_signature_service import refresh_statistical_signature

    fs = get_fs()
    status, cached = await asyncio.gather(
        asyncio.to_thread(fs.get_collection_status, collection_id),
        asyncio.to_thread(fs.get_latest_statistical_signature, collection_id),
    )
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    if cached:
        return signature_to_response(cached)

    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return signature_to_response(data)


@router.post("/collection/{collection_id}/stats/refresh", response_model=CollectionStatsResponse)
async def refresh_collection_stats(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Force-recompute the statistical signature and persist a new immutable snapshot."""
    from api.services.statistical_signature_service import refresh_statistical_signature

    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return signature_to_response(data)


@router.get("/collection/{collection_id}/download")
async def download_collection(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Stream all posts for a collection as a CSV file."""
    fs = get_fs()
    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    config = status.get("config") or {}
    keywords = config.get("keywords", [])
    title_slug = "_".join(keywords[:3]).replace(" ", "-")[:40] if keywords else collection_id[:8]
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"{title_slug}_{today}.csv"

    bq = get_bq()

    export_sql = """
    SELECT
        p.post_id, p.platform, p.channel_handle, p.channel_id,
        p.title, p.content, p.post_url, p.posted_at, p.post_type,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.custom_fields
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    WHERE p.collection_id = @collection_id AND p._rn = 1
    ORDER BY COALESCE(pe.views, 0) DESC
    """

    rows = await asyncio.to_thread(bq.query, export_sql, {"collection_id": collection_id})

    csv_columns = [
        "post_id", "platform", "channel_handle", "channel_id",
        "title", "content", "post_url", "posted_at", "post_type",
        "likes", "shares", "views", "comments_count", "saves",
        "sentiment", "themes", "entities", "ai_summary", "content_type",
    ]

    def generate_csv():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=csv_columns, extrasaction="ignore")
        writer.writeheader()
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        for row in rows:
            record = {k: row.get(k) for k in csv_columns}
            for field in ("themes", "entities"):
                val = record.get(field)
                if isinstance(val, list):
                    record[field] = json.dumps(val)
            writer.writerow(record)
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
