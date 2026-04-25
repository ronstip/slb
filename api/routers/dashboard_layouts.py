"""Dashboard layouts router — persists per-artifact widget layout configuration."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.routers.dashboard_schema import SocialDashboardWidget, MAX_WIDGETS, GRID_COLS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard/layouts", tags=["dashboard-layouts"])

COLLECTION = "dashboard_layouts"


class LayoutSaveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    layout: list[SocialDashboardWidget] = Field(max_length=MAX_WIDGETS)
    filterBarFilters: list[str] | None = None


class LayoutResponse(BaseModel):
    layout: list[dict[str, Any]] | None
    filterBarFilters: list[str] | None = None


@router.get("/{artifact_id}", response_model=LayoutResponse)
async def get_dashboard_layout(
    artifact_id: str,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Get saved layout for a dashboard artifact. Returns null layout if not yet saved."""
    doc_ref = fs._db.collection(COLLECTION).document(artifact_id)
    doc = doc_ref.get()

    if not doc.exists:
        return LayoutResponse(layout=None)

    data = doc.to_dict()

    # Verify ownership
    if data.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Access denied")

    return LayoutResponse(
        layout=data.get("layout"),
        filterBarFilters=data.get("filterBarFilters"),
    )


@router.post("/{artifact_id}", response_model=LayoutResponse)
async def save_dashboard_layout(
    artifact_id: str,
    request: LayoutSaveRequest,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Save (upsert) layout for a dashboard artifact."""
    # Grid bounds — not expressible in Pydantic field validators since it's a cross-field check.
    for idx, w in enumerate(request.layout):
        if w.x + w.w > GRID_COLS:
            raise HTTPException(
                status_code=422,
                detail=f"layout[{idx}]: x ({w.x}) + w ({w.w}) exceeds grid width {GRID_COLS}",
            )

    doc_ref = fs._db.collection(COLLECTION).document(artifact_id)
    doc = doc_ref.get()

    # If doc exists, verify ownership before overwriting
    if doc.exists:
        data = doc.to_dict()
        if data.get("user_id") != user.uid:
            raise HTTPException(status_code=403, detail="Access denied")

    serialized_layout = [w.model_dump(exclude_none=True, by_alias=True) for w in request.layout]
    doc_ref.set({
        "user_id": user.uid,
        "artifact_id": artifact_id,
        "layout": serialized_layout,
        "filterBarFilters": request.filterBarFilters,
    })

    return LayoutResponse(layout=serialized_layout, filterBarFilters=request.filterBarFilters)
