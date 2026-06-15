"""Dashboard sharing router - CRUD for share tokens + public data endpoint."""

import asyncio
import logging
import re
import secrets
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import ORJSONResponse

from api.auth.admin import is_super_admin_email
from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.rate_limiting import limiter
from api.schemas.requests import (
    CreateCustomSlugShareRequest,
    CreateDashboardShareRequest,
)
from api.schemas.responses import (
    DashboardShareResponse,
    SharedDashboardDataResponse,
    SharedDashboardMetaResponse,
)
from api.services.dashboard_cache import (
    get_core,
    make_freshness_stamp,
    perf_logger,
    set_core,
)
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    MAX_ROWS,
    assemble_dashboard_core,
    build_dashboard_kpis_sql,
    build_dashboard_sql,
    build_topics_sql,
    derive_agent_id_for_collections,
)
from api.services.report_transform import transform_posts, validate_report_config
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
        except Exception:  # noqa: BLE001 - best-effort lookup
            continue
        if not doc.exists:
            continue
        data = doc.to_dict() or {}
        title = (data.get("title") or "").strip()
        if title:
            return title
    return fallback


def resolve_share_collection_ids(
    fs, frozen_collection_ids: list[str], agent_id: str | None
) -> list[str]:
    """Resolve the collections a share should serve.

    The share doc freezes `collection_ids` at create time, but the owner's
    explorer renders the agent's CURRENT collection set (`task.collection_ids`).
    Collections added to the agent after the share was made - e.g. a later run
    that introduced new enrichment fields like list[object] - are present in the
    explorer but missing from the frozen snapshot, so widgets bound to those
    fields show "No Data" only on the share.

    Union the snapshot with the agent's live collection_ids so the share tracks
    the agent like the explorer does, never serving fewer collections than were
    frozen. Best-effort: any lookup failure falls back to the frozen list.
    """
    if not agent_id:
        return frozen_collection_ids
    try:
        agent_collection_ids = fs.get_agent_collection_ids(agent_id)
    except Exception:  # noqa: BLE001 - best-effort; never block the public link
        logger.exception("Failed to resolve agent collections for %s", agent_id)
        return frozen_collection_ids
    if not agent_collection_ids:
        return frozen_collection_ids
    return sorted(set(frozen_collection_ids) | set(agent_collection_ids))


# Slugs must look like marketing-friendly URL segments: lowercase alnum + single
# hyphens, 3–64 chars, no leading/trailing hyphen, no consecutive hyphens.
_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$")

# Reserved to avoid colliding with current/future route segments under /shared/.
_RESERVED_SLUGS: frozenset[str] = frozenset({"public", "admin", "api", "new", "create"})


def validate_custom_slug(slug: str) -> None:
    """Reject slugs that don't fit the URL-segment shape or are reserved.

    Raises HTTPException(422) on any failure.
    """
    if not isinstance(slug, str) or len(slug) < 3 or len(slug) > 64:
        raise HTTPException(status_code=422, detail="slug_invalid_length")
    if "--" in slug:
        raise HTTPException(status_code=422, detail="slug_invalid_format")
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=422, detail="slug_invalid_format")
    if slug in _RESERVED_SLUGS:
        raise HTTPException(status_code=422, detail="slug_reserved")


def _assert_can_access_collections(
    fs, user: CurrentUser, collection_ids: list[str]
) -> None:
    """Common access check shared by both share-creation endpoints."""
    for cid in collection_ids:
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
    """Create a shareable link for a dashboard. Idempotent - returns existing if active."""
    fs = get_fs()

    _assert_can_access_collections(fs, user, request.collection_ids)

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
        "is_custom_slug": False,
    }
    fs.create_dashboard_share(token, data)

    return _build_share_response({"token": token, **data, "created_at": now.isoformat()})


# --- Custom-slug shares (super-admin only) ---


@router.post("/custom", response_model=DashboardShareResponse)
async def create_custom_slug_share(
    request: CreateCustomSlugShareRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a vanity-URL shareable link. Super-admin only.

    Replaces any previous custom slug for the same dashboard. Coexists with
    the standard random-token share - the random link keeps working untouched.
    """
    if user.impersonated_by is not None or not is_super_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Super admin access required")

    validate_custom_slug(request.slug)

    fs = get_fs()
    _assert_can_access_collections(fs, user, request.collection_ids)

    # Reject if the slug is already used as a doc ID (random token OR another
    # custom slug). Collision with a random token is astronomically unlikely
    # but the check is free.
    if fs.get_dashboard_share(request.slug):
        raise HTTPException(status_code=409, detail="slug_taken")

    # One custom slug per dashboard - revoke the previous one if it exists.
    previous = fs.get_custom_share_by_dashboard(request.dashboard_id)
    if previous:
        fs.revoke_dashboard_share(previous["token"])

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
        "is_custom_slug": True,
    }
    fs.create_dashboard_share(request.slug, data)

    return _build_share_response({"token": request.slug, **data, "created_at": now.isoformat()})


@router.get("/custom/{dashboard_id}")
async def get_custom_slug_share(
    dashboard_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return the active custom-slug share for a dashboard, or null. Super-admin only."""
    if user.impersonated_by is not None or not is_super_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Super admin access required")

    fs = get_fs()
    share = fs.get_custom_share_by_dashboard(dashboard_id)
    if not share:
        return None
    return _build_share_response(share)


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


def strip_hidden_widgets(layout: list | None) -> list | None:
    """Drop `hidden: true` widgets from a layout served to public viewers.

    Hidden widgets stay in the owner's doc (the editor needs them) but must
    not leak through the unauthenticated share endpoint.
    """
    if not layout:
        return layout
    if not any(isinstance(w, dict) and w.get("hidden") for w in layout):
        return layout
    return [w for w in layout if not (isinstance(w, dict) and w.get("hidden"))]


# --- Public endpoint (no auth, rate-limited) ---


@router.get("/public/{token}", response_model=SharedDashboardDataResponse)
@limiter.limit("30/minute")
async def get_shared_dashboard(
    request: Request,  # required by slowapi
    token: str,
):
    """Public endpoint - serves shared dashboard data without authentication."""
    fs = get_fs()
    share = fs.get_dashboard_share(token)

    if not share or share.get("revoked"):
        raise HTTPException(status_code=404, detail="Dashboard not found or link has been revoked")

    # Resolve live title - the share doc freezes the title at create time;
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
    report_config: dict | None = None
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
            report_config = layout_data.get("reportConfig")
    except Exception:  # noqa: BLE001 - layout is non-critical, fall back to defaults
        logger.exception("Failed to load layout for shared dashboard %s", token)
    layout = strip_hidden_widgets(layout)

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
            except Exception:  # noqa: BLE001 - best-effort backfill
                logger.exception("Failed to backfill agent_id on share %s", token)

    # Track the agent's CURRENT collections, not the snapshot frozen at
    # share-create time, so collections added later (e.g. a run that introduced
    # list[object] enrichment) appear on the share just like in the explorer.
    collection_ids = await asyncio.to_thread(
        resolve_share_collection_ids, fs, collection_ids, agent_id
    )

    if not agent_id:
        # Orphan share - collections were never linked to an agent. Return
        # empty rather than running cross-agent SQL that conflicts with the
        # rest of the agent-scoped surfaces.
        name_rows = await asyncio.to_thread(
            bq.query, COLLECTION_NAMES_SQL, {"collection_ids": collection_ids}
        )
        collection_names = {
            r["collection_id"]: r.get("original_question", r["collection_id"])
            for r in name_rows
        }
        asyncio.create_task(_record_access(fs, token))
        return SharedDashboardDataResponse(
            posts=[],
            topics=[],
            collection_names=collection_names,
            truncated=False,
            meta=meta,
            layout=layout,
            filterBarFilters=filter_bar_filters,
            orientation=orientation,
            reportScope=report_scope,
            filterBarHidden=filter_bar_hidden,
        )

    # Passive-invalidation response cache, shared with the authed endpoint. The
    # stamp is the max collection_status.updated_at across the resolved
    # collections, which the pipeline bumps when post counts change - so a new
    # run's data busts the cache while static data serves without any BigQuery.
    # The share path reads the statuses itself (the authed path gets them from
    # its access check); these Firestore reads are cheap vs the ~8s posts query.
    statuses = await asyncio.gather(
        *(asyncio.to_thread(fs.get_collection_status, cid) for cid in collection_ids)
    )
    stamp = make_freshness_stamp(statuses)
    t0 = time.perf_counter()
    core = get_core(agent_id, collection_ids, stamp)
    cache_hit = core is not None
    gather_ms = serialize_ms = 0.0

    if core is None:
        posts_sql, posts_params = build_dashboard_sql(collection_ids, agent_id, MAX_ROWS + 1)
        kpis_sql, kpis_params = build_dashboard_kpis_sql(collection_ids, agent_id)
        topics_sql, topics_params = build_topics_sql(agent_id)

        rows, kpi_rows, topic_rows, name_rows = await asyncio.gather(
            asyncio.to_thread(bq.query, posts_sql, posts_params),
            asyncio.to_thread(bq.query, kpis_sql, kpis_params),
            asyncio.to_thread(bq.query, topics_sql, topics_params),
            asyncio.to_thread(bq.query, COLLECTION_NAMES_SQL, {"collection_ids": collection_ids}),
        )
        gather_ms = (time.perf_counter() - t0) * 1000

        truncated = len(rows) > MAX_ROWS
        if truncated:
            rows = rows[:MAX_ROWS]

        ts = time.perf_counter()
        core = assemble_dashboard_core(rows, topic_rows, kpi_rows, name_rows, truncated)
        serialize_ms = (time.perf_counter() - ts) * 1000
        set_core(agent_id, collection_ids, stamp, core)

    perf_logger.info(
        "dashboard.share token=%s agent=%s cache=%s posts=%d gather_ms=%.0f serialize_ms=%.0f",
        token, agent_id, "HIT" if cache_hit else "MISS",
        len(core["posts"]), gather_ms, serialize_ms,
    )

    # Fire-and-forget telemetry update
    asyncio.create_task(_record_access(fs, token))

    # Apply the report-level transform (canonicalization + computed fields) so a
    # shared link shows the same canonical numbers as the owner's interactive
    # dashboard. Runs on the cached raw core; an invalid config is ignored here
    # (public view must not 422) - the owner's editor enforces validity on save.
    share_posts = core["posts"]
    if report_config and not validate_report_config(report_config):
        share_posts = transform_posts(core["posts"], report_config)

    # Wrap the cached core (posts/topics/collection_names/truncated) with this
    # share's per-request metadata; kpis in the core are unused here. Returned
    # raw via orjson - shape matches SharedDashboardDataResponse.
    return ORJSONResponse(
        {
            "posts": share_posts,
            "topics": core["topics"],
            "collection_names": core["collection_names"],
            "truncated": core["truncated"],
            "meta": meta.model_dump(),
            "layout": layout,
            "filterBarFilters": filter_bar_filters,
            "orientation": orientation,
            "reportScope": report_scope,
            "filterBarHidden": filter_bar_hidden,
            # Forwarded so the read-only client applies value colors + evaluates
            # expr computed metrics (canonicalization + if/else are already baked
            # into `share_posts` above).
            "reportConfig": report_config,
        }
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
