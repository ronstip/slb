"""Explorer layouts router — per-agent named layout configurations."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/explorer/layouts", tags=["explorer-layouts"])

COLLECTION = "explorer_layouts"
DASHBOARD_LAYOUTS_COLLECTION = "dashboard_layouts"


class ExplorerLayoutCreate(BaseModel):
    agent_id: str
    title: str


class ExplorerLayoutUpdate(BaseModel):
    title: str | None = None


class ExplorerLayoutListItem(BaseModel):
    layout_id: str
    agent_id: str
    title: str
    created_at: str
    updated_at: str


class ExplorerLayoutResponse(ExplorerLayoutListItem):
    pass


@router.get("", response_model=list[ExplorerLayoutListItem])
async def list_explorer_layouts(
    agent_id: str = Query(...),
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """List all explorer layouts for an agent belonging to the current user."""
    # Sort client-side to avoid requiring a composite (agent_id, user_id, updated_at) index.
    docs = list(
        fs._db.collection(COLLECTION)
        .where("agent_id", "==", agent_id)
        .where("user_id", "==", user.uid)
        .stream()
    )
    items = [
        ExplorerLayoutListItem(
            layout_id=doc.id,
            agent_id=doc.get("agent_id") or "",
            title=doc.get("title") or "",
            created_at=doc.get("created_at") or "",
            updated_at=doc.get("updated_at") or "",
        )
        for doc in docs
    ]
    items.sort(key=lambda x: x.updated_at, reverse=True)
    return items


@router.post("", response_model=ExplorerLayoutResponse, status_code=201)
async def create_explorer_layout(
    request: ExplorerLayoutCreate,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Create a new explorer layout (metadata only)."""
    layout_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    fs._db.collection(COLLECTION).document(layout_id).set({
        "agent_id": request.agent_id,
        "user_id": user.uid,
        "title": request.title,
        "created_at": now,
        "updated_at": now,
    })

    return ExplorerLayoutResponse(
        layout_id=layout_id,
        agent_id=request.agent_id,
        title=request.title,
        created_at=now,
        updated_at=now,
    )


@router.patch("/{layout_id}", response_model=ExplorerLayoutResponse)
async def update_explorer_layout(
    layout_id: str,
    request: ExplorerLayoutUpdate,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Rename an explorer layout."""
    doc_ref = fs._db.collection(COLLECTION).document(layout_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Layout not found")

    data = doc.to_dict()
    if data.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Access denied")

    updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if request.title is not None:
        updates["title"] = request.title

    doc_ref.update(updates)
    data.update(updates)

    return ExplorerLayoutResponse(
        layout_id=layout_id,
        agent_id=data["agent_id"],
        title=data["title"],
        created_at=data["created_at"],
        updated_at=data["updated_at"],
    )


@router.delete("/{layout_id}", status_code=204)
async def delete_explorer_layout(
    layout_id: str,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Delete an explorer layout and its associated dashboard layout data."""
    doc_ref = fs._db.collection(COLLECTION).document(layout_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Layout not found")

    data = doc.to_dict()
    if data.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete metadata
    doc_ref.delete()

    # Also delete the associated dashboard layout data (widget config)
    dashboard_doc = fs._db.collection(DASHBOARD_LAYOUTS_COLLECTION).document(layout_id)
    if dashboard_doc.get().exists:
        dashboard_doc.delete()
