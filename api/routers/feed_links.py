"""Feed links router — CRUD for feed link tokens + public data endpoint.

Feed links allow users to generate shareable URLs that serve collection data
as JSON or CSV without authentication, usable as data sources in Excel,
Power BI, and other tools.
"""

import asyncio
import csv
import io
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.rate_limiting import limiter
from api.schemas.requests import CreateFeedLinkRequest
from api.schemas.responses import FeedLinkResponse
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    DASHBOARD_SQL,
    MAX_ROWS,
    build_post_response,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feed-links", tags=["feed-links"])


def _build_feed_link_response(link: dict) -> FeedLinkResponse:
    settings = get_settings()
    base_url = settings.api_base_url.rstrip("/") if hasattr(settings, "api_base_url") and settings.api_base_url else ""
    return FeedLinkResponse(
        token=link["token"],
        title=link["title"],
        collection_ids=link["collection_ids"],
        filters=link.get("filters", {}),
        created_at=link["created_at"] if isinstance(link["created_at"], str) else link["created_at"].isoformat(),
        share_url=f"{base_url}/feed-links/public/{link['token']}",
        active=not link.get("revoked", False),
        access_count=link.get("access_count", 0),
    )


# --- Authenticated endpoints ---


@router.post("", response_model=FeedLinkResponse)
async def create_feed_link(
    request: CreateFeedLinkRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a feed link for a set of collections with optional filters."""
    fs = get_fs()

    # Validate caller can access each collection
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if status.get("user_id") != user.uid:
            if not (
                user.org_id
                and status.get("org_id") == user.org_id
                and status.get("visibility") == "org"
            ):
                raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    data = {
        "owner_uid": user.uid,
        "collection_ids": request.collection_ids,
        "filters": request.filters,
        "title": request.title,
        "created_at": now,
        "revoked": False,
        "revoked_at": None,
        "last_accessed_at": None,
        "access_count": 0,
    }
    fs.create_feed_link(token, data)

    return _build_feed_link_response({"token": token, **data, "created_at": now.isoformat()})


@router.get("", response_model=list[FeedLinkResponse])
async def list_feed_links(
    user: CurrentUser = Depends(get_current_user),
):
    """List the current user's active feed links."""
    fs = get_fs()
    links = fs.list_feed_links_by_owner(user.uid)
    return [_build_feed_link_response(link) for link in links]


@router.delete("/{token}", status_code=204)
async def revoke_feed_link(
    token: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Revoke a feed link. Only the owner can revoke."""
    fs = get_fs()
    link = fs.get_feed_link(token)
    if not link:
        raise HTTPException(status_code=404, detail="Feed link not found")
    if link["owner_uid"] != user.uid:
        raise HTTPException(status_code=403, detail="Not the owner")
    if link.get("revoked"):
        raise HTTPException(status_code=409, detail="Already revoked")
    fs.revoke_feed_link(token)
    return


# --- Public endpoint (no auth, rate-limited) ---


@router.get("/public/{token}")
@limiter.limit("30/minute")
async def get_feed_link_data(
    request: Request,
    token: str,
    format: str = Query("json", regex="^(json|csv)$"),
    limit: int = Query(5000, ge=1, le=10000),
):
    """Public endpoint — serves feed link data without authentication."""
    fs = get_fs()
    link = fs.get_feed_link(token)

    if not link or link.get("revoked"):
        raise HTTPException(status_code=404, detail="Feed link not found or has been revoked")

    bq = get_bq()
    collection_ids = link["collection_ids"]
    params = {"collection_ids": collection_ids}

    effective_limit = min(limit, MAX_ROWS)
    sql = DASHBOARD_SQL.format(max_rows=effective_limit)

    rows = await asyncio.to_thread(bq.query, sql, params)
    posts = [build_post_response(row) for row in rows]

    # Apply stored filters
    filters = link.get("filters", {})
    if filters.get("platform") and filters["platform"] != "all":
        posts = [p for p in posts if p.platform == filters["platform"]]
    if filters.get("sentiment") and filters["sentiment"] != "all":
        posts = [p for p in posts if p.sentiment == filters["sentiment"]]

    # Sort
    sort_key = filters.get("sort", "view_count")
    sort_map = {
        "views": "view_count",
        "engagement": lambda p: p.like_count + p.comment_count + p.view_count,
        "recent": "posted_at",
        "sentiment": "sentiment",
    }
    if sort_key in sort_map:
        sk = sort_map[sort_key]
        if callable(sk):
            posts.sort(key=sk, reverse=True)
        else:
            posts.sort(key=lambda p: getattr(p, sk, 0) or 0, reverse=(sort_key != "sentiment"))

    # Fire-and-forget telemetry
    asyncio.create_task(_record_access(fs, token))

    if format == "csv":
        return _build_csv_response(posts, link.get("title", "feed"))

    # JSON: return flat array for easy consumption by Power Query / Excel
    return [p.model_dump() for p in posts]


def _build_csv_response(posts, title: str) -> StreamingResponse:
    """Stream posts as a CSV file."""
    output = io.StringIO()
    if not posts:
        output.write("")
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{title}.csv"'},
        )

    fieldnames = [
        "post_id", "collection_id", "platform", "channel_handle", "posted_at",
        "title", "content", "sentiment", "emotion", "themes", "entities",
        "language", "content_type",
        "like_count", "view_count", "comment_count", "share_count",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for post in posts:
        row = post.model_dump()
        # Flatten lists to comma-separated strings
        for k in ("themes", "entities"):
            if isinstance(row.get(k), list):
                row[k] = ", ".join(str(v) for v in row[k])
        writer.writerow({f: row.get(f, "") for f in fieldnames})

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{title}.csv"'},
    )


async def _record_access(fs, token: str) -> None:
    """Non-blocking telemetry: update last_accessed_at and increment access_count."""
    try:
        from google.cloud.firestore_v1 import transforms

        await asyncio.to_thread(
            fs._db.collection("feed_links").document(token).update,
            {
                "last_accessed_at": datetime.now(timezone.utc),
                "access_count": transforms.Increment(1),
            },
        )
    except Exception:
        pass
