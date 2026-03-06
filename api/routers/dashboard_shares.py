"""Dashboard sharing router — CRUD for share tokens + public data endpoint."""

import asyncio
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.rate_limiting import limiter
from api.schemas.requests import CreateDashboardShareRequest
from api.schemas.responses import (
    DashboardShareResponse,
    SharedDashboardDataResponse,
    SharedDashboardMetaResponse,
)
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    DASHBOARD_SQL,
    MAX_ROWS,
    build_post_response,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard/shares", tags=["dashboard-shares"])


def _build_share_response(share: dict) -> DashboardShareResponse:
    settings = get_settings()
    base_url = settings.frontend_url.rstrip("/")
    return DashboardShareResponse(
        token=share["token"],
        dashboard_id=share["dashboard_id"],
        title=share["title"],
        collection_ids=share["collection_ids"],
        created_at=share["created_at"] if isinstance(share["created_at"], str) else share["created_at"].isoformat(),
        share_url=f"{base_url}/shared/{share['token']}",
        active=not share.get("revoked", False),
    )


# --- Authenticated endpoints (owner CRUD) ---


@router.post("", response_model=DashboardShareResponse)
async def create_share(
    request: CreateDashboardShareRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a shareable link for a dashboard. Idempotent — returns existing if active."""
    fs = get_fs()

    # Validate caller can access each collection
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if status.get("user_id") != user.uid:
            # Also allow org members with org visibility
            if not (
                user.org_id
                and status.get("org_id") == user.org_id
                and status.get("visibility") == "org"
            ):
                raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    # Idempotency: return existing active share if one exists
    existing = fs.get_dashboard_share_by_dashboard(request.dashboard_id, user.uid)
    if existing:
        return _build_share_response(existing)

    # Generate cryptographically secure token
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    data = {
        "owner_uid": user.uid,
        "dashboard_id": request.dashboard_id,
        "collection_ids": request.collection_ids,
        "title": request.title,
        "created_at": now,
        "revoked": False,
        "revoked_at": None,
        "last_accessed_at": None,
        "access_count": 0,
    }
    fs.create_dashboard_share(token, data)

    return _build_share_response({"token": token, **data, "created_at": now.isoformat()})


@router.get("/{dashboard_id}")
async def get_share(
    dashboard_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Check if an active share exists for a dashboard the user owns."""
    fs = get_fs()
    share = fs.get_dashboard_share_by_dashboard(dashboard_id, user.uid)
    if not share:
        return None
    return _build_share_response(share)


@router.delete("/{token}", status_code=204)
async def revoke_share(
    token: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Revoke a share token. Only the owner can revoke."""
    fs = get_fs()
    share = fs.get_dashboard_share(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    if share["owner_uid"] != user.uid:
        raise HTTPException(status_code=403, detail="Not the owner")
    if share.get("revoked"):
        raise HTTPException(status_code=409, detail="Already revoked")
    fs.revoke_dashboard_share(token)
    return


# --- Public endpoint (no auth, rate-limited) ---


@router.get("/public/{token}", response_model=SharedDashboardDataResponse)
@limiter.limit("30/minute")
async def get_shared_dashboard(
    request: Request,  # required by slowapi
    token: str,
):
    """Public endpoint — serves shared dashboard data without authentication."""
    fs = get_fs()
    share = fs.get_dashboard_share(token)

    if not share or share.get("revoked"):
        raise HTTPException(status_code=404, detail="Dashboard not found or link has been revoked")

    bq = get_bq()
    collection_ids = share["collection_ids"]
    params = {"collection_ids": collection_ids}

    sql = DASHBOARD_SQL.format(max_rows=MAX_ROWS + 1)

    rows, name_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, sql, params),
        asyncio.to_thread(bq.query, COLLECTION_NAMES_SQL, params),
    )

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]

    collection_names = {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }

    posts = [build_post_response(row) for row in rows]

    # Fire-and-forget telemetry update
    asyncio.create_task(_record_access(fs, token))

    return SharedDashboardDataResponse(
        posts=posts,
        collection_names=collection_names,
        truncated=truncated,
        meta=SharedDashboardMetaResponse(
            title=share["title"],
            created_at=share["created_at"],
        ),
    )


async def _record_access(fs, token: str) -> None:
    """Non-blocking telemetry: update last_accessed_at and increment access_count."""
    try:
        from google.cloud.firestore_v1 import transforms

        await asyncio.to_thread(
            fs._db.collection("dashboard_shares").document(token).update,
            {
                "last_accessed_at": datetime.now(timezone.utc),
                "access_count": transforms.Increment(1),
            },
        )
    except Exception:
        pass  # Telemetry failure must never break the response
