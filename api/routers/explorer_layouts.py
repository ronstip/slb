"""Explorer layouts router - per-agent named layout configurations."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.services.collection_service import can_access_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/explorer/layouts", tags=["explorer-layouts"])

COLLECTION = "explorer_layouts"
DASHBOARD_LAYOUTS_COLLECTION = "dashboard_layouts"


def _require_agent_access(user: CurrentUser, agent: dict | None) -> None:
    """Gate a layout operation on its owning agent.

    Explorer layouts are components of an agent (see
    docs/agent-sharing-architecture.md): whoever can access the agent can read
    and edit its layouts. Shared agents are thus collaboratively editable; a
    private agent's layouts stay owner-only. Pass the already-fetched agent dict
    so the Firestore read can stay off the event loop in the caller.
    """
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not can_access_agent(user, agent):
        raise HTTPException(status_code=403, detail="Access denied")


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
    """List all explorer layouts for an agent the user can access.

    Layouts belong to the agent, not the requesting user: any member who can
    access the agent (owner, or org member of a shared agent) sees the full set,
    so views are collaborative on a shared agent.
    """
    agent = await asyncio.to_thread(fs.get_agent, agent_id)
    _require_agent_access(user, agent)

    # Sort client-side to avoid requiring a composite (agent_id, updated_at) index.
    # Firestore's Python client is synchronous; running .stream() on the asyncio
    # loop stalls every concurrent request - push it to a worker thread.
    def _fetch():
        return list(
            fs._db.collection(COLLECTION)
            .where("agent_id", "==", agent_id)
            .stream()
        )

    docs = await asyncio.to_thread(_fetch)
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
    agent = await asyncio.to_thread(fs.get_agent, request.agent_id)
    _require_agent_access(user, agent)

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
    """Rename an explorer layout (any member who can access the agent)."""
    doc_ref = fs._db.collection(COLLECTION).document(layout_id)
    doc = await asyncio.to_thread(doc_ref.get)

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Layout not found")

    data = doc.to_dict()
    agent = await asyncio.to_thread(fs.get_agent, data.get("agent_id"))
    _require_agent_access(user, agent)

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
    """Delete an explorer layout (any member who can access the agent)."""
    doc_ref = fs._db.collection(COLLECTION).document(layout_id)
    doc = await asyncio.to_thread(doc_ref.get)

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Layout not found")

    data = doc.to_dict()
    agent = await asyncio.to_thread(fs.get_agent, data.get("agent_id"))
    _require_agent_access(user, agent)

    # Delete metadata
    await asyncio.to_thread(doc_ref.delete)

    # Also delete the associated dashboard layout data (widget config)
    dashboard_doc = fs._db.collection(DASHBOARD_LAYOUTS_COLLECTION).document(layout_id)
    if (await asyncio.to_thread(dashboard_doc.get)).exists:
        await asyncio.to_thread(dashboard_doc.delete)
