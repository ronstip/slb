"""Dashboard layouts router - persists per-artifact widget layout configuration."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.routers.dashboard_schema import (
    DashboardOrientation,
    ReportScope,
    SocialDashboardWidget,
    MAX_WIDGETS,
    GRID_COLS,
)
from api.services.collection_service import can_access_component

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard/layouts", tags=["dashboard-layouts"])

COLLECTION = "dashboard_layouts"
EXPLORER_LAYOUTS_COLLECTION = "explorer_layouts"


def _resolve_share_doc(fs, key_id: str) -> dict | None:
    """Resolve the doc whose org-share state governs a dashboard layout.

    A `dashboard_layouts` doc is keyed by one of two things:
      - an **artifact_id** - an artifact-backed dashboard (briefs/social
        dashboard saved as a deliverable); or
      - an **explorer layout_id** - an explorer *view* (DashboardView passes the
        explorer layout's id as `artifact.id`), which has no artifact doc.

    Both resolve to a component of an agent, so return the governing doc:
    the artifact, or the explorer layout's owning agent. `can_access_component`
    handles either (artifacts gate on `shared`, agents on `visibility`).
    Returns None when neither exists (orphan / restored session).
    """
    artifact = fs.get_artifact(key_id)
    if artifact is not None:
        return artifact
    snap = fs._db.collection(EXPLORER_LAYOUTS_COLLECTION).document(key_id).get()
    if snap.exists:
        return fs.get_agent((snap.to_dict() or {}).get("agent_id"))
    return None


def _require_dashboard_access(
    user: CurrentUser, share_doc: dict | None, layout_data: dict | None
) -> None:
    """Gate a dashboard (widget) layout on its resolved owning artifact/agent.

    When the owning agent is shared, every org member can read AND edit the
    single shared widget layout (collaborative). Fallback: when nothing could be
    resolved (orphaned / restored-session doc), fall back to the layout doc's
    own owner so legacy private docs stay private.
    """
    if share_doc is not None:
        if not can_access_component(user, share_doc):
            raise HTTPException(status_code=403, detail="Access denied")
        return
    if layout_data is not None and layout_data.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Access denied")


# Widths at or below the small (sm=4) breakpoint's column count. A desktop
# layout authored on the 12-col grid never crams every widget into <=4 cols at
# x=0 - that signature only appears when react-grid-layout's compact (mobile)
# layout leaks into the canonical desktop slot. Story Mode stacks full-width
# (w=12), so it is never caught.
_COMPACT_MAX_W = 4


def _is_collapsed_mobile_layout(layout: list[SocialDashboardWidget]) -> bool:
    """True when a layout looks like a persisted MOBILE/compact layout rather
    than an authored desktop one: 3+ widgets, ALL at x=0, none wider than the
    small breakpoint. Persisting this collapses the dashboard to one long narrow
    column on desktop and on shared links (see test_layout_collapse_guard.py).
    """
    if len(layout) < 3:
        return False
    return all(w.x == 0 for w in layout) and all(w.w <= _COMPACT_MAX_W for w in layout)


class LayoutSaveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    layout: list[SocialDashboardWidget] = Field(max_length=MAX_WIDGETS)
    filterBarFilters: list[str] | None = None
    orientation: DashboardOrientation | None = None
    reportScope: ReportScope | None = None
    filterBarHidden: bool | None = None


class LayoutResponse(BaseModel):
    layout: list[dict[str, Any]] | None
    filterBarFilters: list[str] | None = None
    orientation: DashboardOrientation | None = None
    reportScope: ReportScope | None = None
    filterBarHidden: bool | None = None


@router.get("/{artifact_id}", response_model=LayoutResponse)
async def get_dashboard_layout(
    artifact_id: str,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Get saved layout for a dashboard artifact. Returns null layout if not yet saved."""
    doc_ref = fs._db.collection(COLLECTION).document(artifact_id)
    doc = await asyncio.to_thread(doc_ref.get)
    share_doc = await asyncio.to_thread(_resolve_share_doc, fs, artifact_id)

    layout_data = doc.to_dict() if doc.exists else None
    _require_dashboard_access(user, share_doc, layout_data)

    if not doc.exists:
        return LayoutResponse(layout=None)

    data = layout_data

    return LayoutResponse(
        layout=data.get("layout"),
        filterBarFilters=data.get("filterBarFilters"),
        orientation=data.get("orientation"),
        reportScope=data.get("reportScope"),
        filterBarHidden=data.get("filterBarHidden"),
    )


@router.post("/{artifact_id}", response_model=LayoutResponse)
async def save_dashboard_layout(
    artifact_id: str,
    request: LayoutSaveRequest,
    user: CurrentUser = Depends(get_current_user),
    fs=Depends(get_fs),
):
    """Save (upsert) layout for a dashboard artifact."""
    # Grid bounds - not expressible in Pydantic field validators since it's a cross-field check.
    for idx, w in enumerate(request.layout):
        if w.x + w.w > GRID_COLS:
            raise HTTPException(
                status_code=422,
                detail=f"layout[{idx}]: x ({w.x}) + w ({w.w}) exceeds grid width {GRID_COLS}",
            )

    # Backstop against the single-column corruption: refuse to overwrite the
    # canonical desktop layout with a collapsed mobile/compact layout. This doc
    # is shared across local/dev/prod and read live by the public share endpoint,
    # so a stale or buggy client must not be able to poison it.
    if _is_collapsed_mobile_layout(request.layout):
        logger.warning(
            "Rejected collapsed-mobile layout save for %s (user=%s, %d widgets)",
            artifact_id, user.uid, len(request.layout),
        )
        raise HTTPException(
            status_code=422,
            detail=(
                "Refused to save: this looks like a collapsed mobile layout "
                "(every widget at x=0, narrow). The desktop layout was not "
                "overwritten."
            ),
        )

    doc_ref = fs._db.collection(COLLECTION).document(artifact_id)
    doc = await asyncio.to_thread(doc_ref.get)
    share_doc = await asyncio.to_thread(_resolve_share_doc, fs, artifact_id)

    # Gate the write on the resolved owning artifact/agent (shared = collaborative).
    layout_data = doc.to_dict() if doc.exists else None
    _require_dashboard_access(user, share_doc, layout_data)

    serialized_layout = [w.model_dump(exclude_none=True, by_alias=True) for w in request.layout]
    serialized_scope = (
        request.reportScope.model_dump(exclude_none=True, by_alias=True)
        if request.reportScope is not None
        else None
    )
    # MERGE the layout fields rather than replacing the whole doc. Without
    # `merge=True`, `.set()` drops every field not in the payload - including
    # `is_template`, `title`, and `source_template_id` - silently demoting docs.
    await asyncio.to_thread(
        doc_ref.set,
        {
            "user_id": user.uid,
            "artifact_id": artifact_id,
            "layout": serialized_layout,
            "filterBarFilters": request.filterBarFilters,
            "orientation": request.orientation,
            "reportScope": serialized_scope,
            "filterBarHidden": request.filterBarHidden,
            # Stamp editor saves too (the agent's update_dashboard already does).
            # Without this, a manual save left updated_at showing the last *agent*
            # write, which masked when the layout actually changed.
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )

    return LayoutResponse(
        layout=serialized_layout,
        filterBarFilters=request.filterBarFilters,
        orientation=request.orientation,
        reportScope=request.reportScope,
        filterBarHidden=request.filterBarHidden,
    )
