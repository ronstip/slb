"""Briefing sharing router — CRUD for share tokens + public briefing endpoint."""

import asyncio
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.rate_limiting import limiter
from api.routers.briefing import check_agent_access, read_cached_briefing
from api.schemas.requests import CreateBriefingShareRequest
from api.schemas.responses import (
    BriefingShareResponse,
    SharedBriefingDataResponse,
    SharedBriefingMetaResponse,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/briefing/shares", tags=["briefing-shares"])


def _build_share_response(share: dict) -> BriefingShareResponse:
    settings = get_settings()
    base_url = settings.frontend_url.rstrip("/")
    created = share["created_at"]
    return BriefingShareResponse(
        token=share["token"],
        agent_id=share["agent_id"],
        title=share["title"],
        created_at=created if isinstance(created, str) else created.isoformat(),
        share_url=f"{base_url}/shared/briefing/{share['token']}",
        active=not share.get("revoked", False),
    )


# --- Authenticated endpoints (owner CRUD) ---


@router.post("", response_model=BriefingShareResponse)
async def create_share(
    request: CreateBriefingShareRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a shareable link for an agent's briefing. Idempotent — returns existing if active."""
    fs = get_fs()
    await asyncio.to_thread(check_agent_access, fs, user, request.agent_id)

    existing = fs.get_briefing_share_by_agent(request.agent_id, user.uid)
    if existing:
        return _build_share_response(existing)

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    data = {
        "owner_uid": user.uid,
        "agent_id": request.agent_id,
        "title": request.title,
        "created_at": now,
        "revoked": False,
        "revoked_at": None,
        "last_accessed_at": None,
        "access_count": 0,
    }
    fs.create_briefing_share(token, data)

    return _build_share_response({"token": token, **data, "created_at": now.isoformat()})


@router.get("/{agent_id}")
async def get_share(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Check if an active share exists for an agent's briefing the user owns."""
    fs = get_fs()
    share = fs.get_briefing_share_by_agent(agent_id, user.uid)
    if not share:
        return None
    return _build_share_response(share)


@router.delete("/{token}", status_code=204)
async def revoke_share(
    token: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Revoke a briefing share token. Only the owner can revoke."""
    fs = get_fs()
    share = fs.get_briefing_share(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    if share["owner_uid"] != user.uid:
        raise HTTPException(status_code=403, detail="Not the owner")
    if share.get("revoked"):
        raise HTTPException(status_code=409, detail="Already revoked")
    fs.revoke_briefing_share(token)
    return


# --- Public endpoint (no auth, rate-limited) ---


@router.get("/public/{token}", response_model=SharedBriefingDataResponse)
@limiter.limit("30/minute")
async def get_shared_briefing(
    request: Request,  # required by slowapi
    token: str,
):
    """Public endpoint — serves shared briefing without authentication."""
    fs = get_fs()
    share = fs.get_briefing_share(token)

    if not share or share.get("revoked"):
        raise HTTPException(status_code=404, detail="Briefing not found or link has been revoked")

    layout = await asyncio.to_thread(read_cached_briefing, fs, share["agent_id"])
    if layout is None:
        raise HTTPException(status_code=404, detail="Briefing not available")

    asyncio.create_task(_record_access(fs, token))

    return SharedBriefingDataResponse(
        layout=layout,
        meta=SharedBriefingMetaResponse(
            title=share["title"],
            created_at=share["created_at"],
        ),
    )


async def _record_access(fs, token: str) -> None:
    """Non-blocking telemetry: update last_accessed_at and increment access_count."""
    try:
        from google.cloud.firestore_v1 import transforms

        await asyncio.to_thread(
            fs._db.collection("briefing_shares").document(token).update,
            {
                "last_accessed_at": datetime.now(timezone.utc),
                "access_count": transforms.Increment(1),
            },
        )
    except Exception:
        pass  # Telemetry failure must never break the response
