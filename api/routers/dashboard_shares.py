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
    MAX_ROWS,
    build_dashboard_sql,
    build_post_response,
    derive_agent_id_for_collections,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard/shares", tags=["dashboard-shares"])


def resolve_current_dashboard_title(fs_db, dashboard_id: str, fallback: str) -> str:
    """Resolve the live title for a shared dashboard.

    The share doc stores the title at create time and never re-syncs on rename,
    so we look it up from the authoritative source: the explorer layout (named
    dashboards) or the artifact doc (auto-generated dashboards). Falls back to
    the frozen `share["title"]` when neither lookup yields a non-empty title.
    """
    for collection in ("explorer_layouts", "artifacts"):
        try:
            doc = fs_db.collection(collection).document(dashboard_id).get()
        except Exception:  # noqa: BLE001 — best-effort lookup
            continue
        if not doc.exists:
            continue
        data = doc.to_dict() or {}
        title = (data.get("title") or "").strip()
        if title:
            return title
    return fallback


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
        "agent_id": request.agent_id,
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

    # Resolve live title — the share doc freezes the title at create time;
    # owner renames go to explorer_layouts / artifacts and never touch the
    # share doc. Look up the current title so renames propagate to the link.
    current_title = await asyncio.to_thread(
        resolve_current_dashboard_title,
        fs._db,
        share["dashboard_id"],
        share["title"],
    )
    meta = SharedDashboardMetaResponse(
        title=current_title,
        created_at=share["created_at"],
    )

    # Load owner's saved widget layout for this dashboard. The share token has
    # already authorized public access, so we bypass the ownership check that
    # the authenticated /dashboard/layouts route enforces.
    layout: list[dict] | None = None
    filter_bar_filters: list[str] | None = None
    orientation: str | None = None
    report_scope: dict | None = None
    filter_bar_hidden: bool | None = None
    try:
        layout_doc = await asyncio.to_thread(
            fs._db.collection("dashboard_layouts").document(share["dashboard_id"]).get
        )
        if layout_doc.exists:
            layout_data = layout_doc.to_dict()
            layout = layout_data.get("layout")
            filter_bar_filters = layout_data.get("filterBarFilters")
            orientation = layout_data.get("orientation")
            report_scope = layout_data.get("reportScope")
            filter_bar_hidden = layout_data.get("filterBarHidden")
    except Exception:  # noqa: BLE001 — layout is non-critical, fall back to defaults
        logger.exception("Failed to load layout for shared dashboard %s", token)

    bq = get_bq()
    collection_ids = share["collection_ids"]
    agent_id = share.get("agent_id")

    # Backfill agent_id on shares created before agent-scoping landed: derive
    # it from the collections, persist on the share doc so subsequent renders
    # skip the lookup, then use it.
    if not agent_id:
        agent_id = await asyncio.to_thread(
            derive_agent_id_for_collections, fs, collection_ids
        )
        if agent_id:
            try:
                await asyncio.to_thread(
                    fs._db.collection("dashboard_shares").document(token).update,
                    {"agent_id": agent_id},
                )
            except Exception:  # noqa: BLE001 — best-effort backfill
                logger.exception("Failed to backfill agent_id on share %s", token)

    name_rows = await asyncio.to_thread(
        bq.query, COLLECTION_NAMES_SQL, {"collection_ids": collection_ids}
    )
    collection_names = {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }

    if not agent_id:
        # Orphan share — collections were never linked to an agent. Return
        # empty rather than running cross-agent SQL that conflicts with the
        # rest of the agent-scoped surfaces.
        asyncio.create_task(_record_access(fs, token))
        return SharedDashboardDataResponse(
            posts=[],
            collection_names=collection_names,
            truncated=False,
            meta=meta,
            layout=layout,
            filterBarFilters=filter_bar_filters,
            orientation=orientation,
            reportScope=report_scope,
            filterBarHidden=filter_bar_hidden,
        )

    posts_sql, posts_params = build_dashboard_sql(collection_ids, agent_id, MAX_ROWS + 1)
    rows = await asyncio.to_thread(bq.query, posts_sql, posts_params)

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]

    posts = [build_post_response(row) for row in rows]

    # Fire-and-forget telemetry update
    asyncio.create_task(_record_access(fs, token))

    return SharedDashboardDataResponse(
        posts=posts,
        collection_names=collection_names,
        truncated=truncated,
        meta=meta,
        layout=layout,
        filterBarFilters=filter_bar_filters,
        orientation=orientation,
        reportScope=report_scope,
        filterBarHidden=filter_bar_hidden,
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
