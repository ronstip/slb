"""Artifacts router — list, retrieve, update, and delete artifacts."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.schemas.artifacts import (
    ArtifactDetailResponse,
    ArtifactListItem,
    UpdateArtifactRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _can_access(user: CurrentUser, artifact: dict) -> bool:
    if artifact.get("user_id") == user.uid:
        return True
    if user.org_id and artifact.get("org_id") == user.org_id and artifact.get("shared"):
        return True
    return False


@router.get("/artifacts", response_model=list[ArtifactListItem])
async def list_artifacts(user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    return fs.list_artifacts(user.uid, user.org_id)


@router.get("/artifacts/{artifact_id}", response_model=ArtifactDetailResponse)
async def get_artifact(artifact_id: str, user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not _can_access(user, artifact):
        raise HTTPException(403, "Access denied")
    return artifact


@router.patch("/artifacts/{artifact_id}")
async def update_artifact(
    artifact_id: str,
    body: UpdateArtifactRequest,
    user: CurrentUser = Depends(get_current_user),
):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if artifact.get("user_id") != user.uid:
        raise HTTPException(403, "Only the owner can modify this artifact")
    updates = body.model_dump(exclude_none=True)
    if updates:
        fs.update_artifact(artifact_id, **updates)
    return {"status": "updated"}


@router.delete("/artifacts/{artifact_id}")
async def delete_artifact(artifact_id: str, user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if artifact.get("user_id") != user.uid:
        raise HTTPException(403, "Only the owner can delete this artifact")
    fs.delete_artifact(artifact_id)
    return {"status": "deleted"}
