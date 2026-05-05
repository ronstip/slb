"""Artifact sharing router — CRUD for share tokens + public artifact endpoint."""

import asyncio
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs, get_gcs
from api.rate_limiting import limiter
from api.schemas.requests import CreateArtifactShareRequest
from api.schemas.responses import (
    ArtifactShareResponse,
    SharedArtifactDataResponse,
    SharedArtifactMetaResponse,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artifacts/shares", tags=["artifact-shares"])


def _build_share_response(share: dict) -> ArtifactShareResponse:
    settings = get_settings()
    base_url = settings.frontend_url.rstrip("/")
    created = share["created_at"]
    return ArtifactShareResponse(
        token=share["token"],
        artifact_id=share["artifact_id"],
        title=share["title"],
        created_at=created if isinstance(created, str) else created.isoformat(),
        share_url=f"{base_url}/shared/artifact/{share['token']}",
        active=not share.get("revoked", False),
    )


def _check_artifact_owner(fs, user: CurrentUser, artifact_id: str) -> dict:
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if artifact.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the owner can share this artifact")
    return artifact


# --- Authenticated endpoints (owner CRUD) ---


@router.post("", response_model=ArtifactShareResponse)
async def create_share(
    request: CreateArtifactShareRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a shareable link for an artifact. Idempotent — returns existing if active."""
    fs = get_fs()
    artifact = await asyncio.to_thread(_check_artifact_owner, fs, user, request.artifact_id)

    existing = fs.get_artifact_share_by_artifact(request.artifact_id, user.uid)
    if existing:
        return _build_share_response(existing)

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)

    data = {
        "owner_uid": user.uid,
        "artifact_id": request.artifact_id,
        "title": artifact.get("title") or "Shared artifact",
        "created_at": now,
        "revoked": False,
        "revoked_at": None,
        "last_accessed_at": None,
        "access_count": 0,
    }
    fs.create_artifact_share(token, data)

    return _build_share_response({"token": token, **data, "created_at": now.isoformat()})


@router.get("/by-artifact/{artifact_id}")
async def get_share(
    artifact_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Check if an active share exists for an artifact the user owns."""
    fs = get_fs()
    share = fs.get_artifact_share_by_artifact(artifact_id, user.uid)
    if not share:
        return None
    return _build_share_response(share)


@router.delete("/{token}", status_code=204)
async def revoke_share(
    token: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Revoke an artifact share token. Only the owner can revoke."""
    fs = get_fs()
    share = fs.get_artifact_share(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    if share["owner_uid"] != user.uid:
        raise HTTPException(status_code=403, detail="Not the owner")
    if share.get("revoked"):
        raise HTTPException(status_code=409, detail="Already revoked")
    fs.revoke_artifact_share(token)
    return


# --- Public endpoint (no auth, rate-limited) ---


@router.get("/public/{token}", response_model=SharedArtifactDataResponse)
@limiter.limit("30/minute")
async def get_shared_artifact(
    request: Request,  # required by slowapi
    token: str,
):
    """Public endpoint — serves shared artifact without authentication."""
    fs = get_fs()
    share = fs.get_artifact_share(token)

    if not share or share.get("revoked"):
        raise HTTPException(status_code=404, detail="Artifact not found or link has been revoked")

    artifact = await asyncio.to_thread(fs.get_artifact, share["artifact_id"])
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not available")

    asyncio.create_task(_record_access(fs, token))

    created = artifact.get("created_at")
    created_str = (
        created.isoformat() if hasattr(created, "isoformat") else str(created or "")
    )

    return SharedArtifactDataResponse(
        payload=artifact.get("payload") or {},
        meta=SharedArtifactMetaResponse(
            title=artifact.get("title") or share["title"],
            type=artifact.get("type") or "",
            created_at=created_str,
        ),
    )


async def _record_access(fs, token: str) -> None:
    """Non-blocking telemetry: update last_accessed_at and increment access_count."""
    try:
        from google.cloud.firestore_v1 import transforms

        await asyncio.to_thread(
            fs._db.collection("artifact_shares").document(token).update,
            {
                "last_accessed_at": datetime.now(timezone.utc),
                "access_count": transforms.Increment(1),
            },
        )
    except Exception:
        pass  # Telemetry failure must never break the response


@router.get("/public/{token}/presentation.pptx")
@limiter.limit("30/minute")
async def download_shared_presentation(
    request: Request,  # required by slowapi
    token: str,
):
    """Public presentation download — serves the .pptx for a shared presentation artifact."""
    fs = get_fs()
    share = fs.get_artifact_share(token)
    if not share or share.get("revoked"):
        raise HTTPException(status_code=404, detail="Not found")

    artifact = await asyncio.to_thread(fs.get_artifact, share["artifact_id"])
    if not artifact or artifact.get("type") != "presentation":
        raise HTTPException(status_code=404, detail="Presentation not available")

    gcs_path = (artifact.get("payload") or {}).get("gcs_path", "")
    if not gcs_path:
        raise HTTPException(status_code=404, detail="Presentation file not found")

    settings = get_settings()
    bucket_name = settings.gcs_presentations_bucket

    client = get_gcs()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(gcs_path)
    if not blob.exists():
        raise HTTPException(status_code=404, detail="Presentation file not found in storage")

    safe_title = (artifact.get("title") or "presentation").replace(" ", "_")[:60]
    filename = f"{safe_title}.pptx"

    def stream():
        with blob.open("rb") as f:
            while chunk := f.read(256 * 1024):
                yield chunk

    return StreamingResponse(
        stream(),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
