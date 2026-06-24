"""Dashboard sharing router - CRUD for share tokens + public data endpoint."""

import asyncio
import logging
import re
import secrets
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
    SharePostDetailsRequest,
)
from api.schemas.responses import (
    DashboardShareResponse,
    SharedDashboardDataResponse,
    SharedDashboardMetaResponse,
)
from api.services.dashboard_cache import (
    make_freshness_stamp,
    perf_logger,
)
from api.services.dashboard_aggregate import (
    build_feed_data_map,
    build_table_data_map,
    build_widget_data_map,
    layout_fully_covered,
)
from api.services.dashboard_response import gzipped_json_response, share_cache_key
from api.services.dashboard_scope import apply_report_scope
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    build_post_details,
    derive_agent_id_for_collections,
    get_or_build_core,
    strip_detail_fields,
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
    slim: bool = False,
    agg: str | None = None,
):
    """Public endpoint - serves shared dashboard data without authentication.

    With `?slim=1` the heavy display-only fields are omitted from each post and
    the read-only client lazy-fetches them per visible post via
    `/dashboard/shares/public/{token}/post-details`. Default keeps the full
    payload so existing/cached clients are unaffected.

    Server-side aggregation (P2) computes the `WidgetData`/`tableData`/`feedData`
    for every server-aggregatable widget in the layout and, when the whole layout
    is covered, drops the raw posts array (payload becomes KB/widget). It is ON by
    default (gated by the `DASHBOARD_SERVER_AGG` setting — the global kill switch);
    a per-request `?agg=client` (or `?agg=off`) forces the legacy full-posts path
    for debugging. Any widget the engine can't reproduce keeps client-side
    aggregation, so the response is always a strict superset.
    """
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
    # its access check). These reads run on EVERY request (before the cache
    # check), so they're batched into a single Firestore round-trip - one
    # `get_all` instead of one read per collection (36+ on a large share).
    statuses_map = await asyncio.to_thread(
        fs.get_collection_statuses, collection_ids
    )
    stamp = make_freshness_stamp(statuses_map.values())
    core, cache_hit, gather_ms, serialize_ms = await get_or_build_core(
        bq, agent_id, collection_ids, stamp
    )

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
    canon_posts = core["posts"]
    if report_config and not validate_report_config(report_config):
        canon_posts = transform_posts(core["posts"], report_config)

    # Comments (dataSource: comments/both) are canonicalized the same way and
    # shipped whole - the share's server-agg engine is posts-only, so comment
    # widgets render client-side from this array (same as any uncovered widget).
    canon_comments = core.get("comments", [])
    if canon_comments and report_config and not validate_report_config(report_config):
        canon_comments = transform_posts(canon_comments, report_config)

    # P2 (opt-in): server-aggregate every eligible widget over the canonicalized
    # posts (before slimming - slimming only drops display-only fields, which
    # aggregation never reads). The share's filter bar is hidden, so each
    # widget's input set is static and computable here. Widgets the engine can't
    # reproduce exactly (object-list edge cases, computed-expr, runtime metric
    # toggles) are skipped and keep client-side aggregation.
    # Default-on (gated by the kill-switch setting); a per-request `agg=client`/
    # `agg=off` forces the legacy full-posts path. The resolved bool is folded
    # into the share cache key, so flagged/unflagged bodies never collide.
    settings = get_settings()
    server_agg_enabled = settings.dashboard_server_agg and agg not in ("client", "off")
    # A committed reportScope is the floor for every widget aggregation. The
    # read-only client narrows its displayed set to the scope (filter bar hidden →
    # empty viewer selection → scope promoted to active filters); reproduce that
    # here so the engine aggregates over the SAME posts (and same percent
    # baseline). When NOT fully covered we still ship the FULL posts below so any
    # uncovered widget re-applies the scope client-side (unchanged behaviour).
    agg_input = apply_report_scope(canon_posts, report_scope) if server_agg_enabled else canon_posts
    widget_data = build_widget_data_map(agg_input, layout) if server_agg_enabled else {}
    table_data = build_table_data_map(agg_input, layout) if server_agg_enabled else {}
    feed_data = build_feed_data_map(agg_input, layout) if server_agg_enabled else {}

    # When EVERY widget is server-satisfied (aggregated series/table, bounded
    # feed, or static), drop the full posts array and ship only the bounded union
    # of feed (embed) posts — the payload becomes KB/widget, independent of post
    # count. Otherwise keep the full posts so any uncovered widget still
    # aggregates client-side (unchanged behaviour).
    fully_covered = server_agg_enabled and layout_fully_covered(
        layout, widget_data, table_data, feed_data
    )
    if fully_covered:
        union: dict[str, dict] = {}
        for plist in feed_data.values():
            for p in plist:
                union.setdefault(p["post_id"], p)
        body_posts = list(union.values())
    else:
        body_posts = canon_posts
    # Feed widgets reference their posts by id (bodies live once in `posts`),
    # preserving each widget's ranked display order.
    feed_ids = {wid: [p["post_id"] for p in plist] for wid, plist in feed_data.items()}

    # Slim mode drops the heavy display-only fields; the read-only client
    # lazy-fetches them per visible post via the share post-details endpoint
    # (same cached core). The share's filter bar is hidden, so the displayed set
    # is static and the fetch happens once per visible widget.
    share_posts = strip_detail_fields(body_posts) if slim else body_posts
    share_comments = strip_detail_fields(canon_comments) if slim else canon_comments

    # Wrap the cached core (posts/topics/collection_names/truncated) with this
    # share's per-request metadata; kpis in the core are unused here. Shape
    # matches SharedDashboardDataResponse.
    body = {
        "posts": share_posts,
        "topics": core["topics"],
        "comments": share_comments,
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
    # Only present when opted in, so an unflagged response is byte-identical to
    # the pre-P2 body (and shares no cache entry with the flagged one).
    if server_agg_enabled:
        body["widgetData"] = widget_data
        body["tableData"] = table_data
        body["feedData"] = feed_ids
        # True → `posts` is only the bounded feed union; the read-only client
        # must render every widget from widgetData/tableData/feedData (it does).
        body["serverComplete"] = fully_covered

    # Gzip-capable clients are served the compressed body from the
    # response-bytes cache. The key folds in the share metadata (title/layout/
    # filter config/reportConfig) ON TOP OF the data freshness stamp + slim,
    # because those change the body but NOT the stamp - keying only on the stamp
    # would serve a stale layout after an owner edit.
    cache_key = share_cache_key(
        token,
        stamp,
        slim,
        {
            "title": current_title,
            "layout": layout,
            "filterBarFilters": filter_bar_filters,
            "orientation": orientation,
            "reportScope": report_scope,
            "filterBarHidden": filter_bar_hidden,
            "reportConfig": report_config,
        },
        server_agg_enabled,
    )
    return gzipped_json_response(
        body, cache_key, request.headers.get("accept-encoding", "")
    )


@router.post("/public/{token}/post-details")
@limiter.limit("60/minute")
async def get_shared_post_details(
    request: Request,  # required by slowapi
    token: str,
    body: SharePostDetailsRequest,
):
    """Public lazy-load of the display-only fields (ai_summary/context/
    media_refs) for the bounded set of posts a shared dashboard currently shows.
    Served from the same cached core as the share data endpoint, so a warm share
    answers without touching BigQuery. Scope is the share's own collections, so
    a caller can never read posts outside the link.
    """
    fs = get_fs()
    share = fs.get_dashboard_share(token)
    if not share or share.get("revoked"):
        raise HTTPException(
            status_code=404, detail="Dashboard not found or link has been revoked"
        )
    if not body.post_ids:
        return ORJSONResponse({"details": {}})
    if len(body.post_ids) > 2000:
        raise HTTPException(status_code=400, detail="too many post_ids (max 2000)")

    collection_ids = share["collection_ids"]
    agent_id = share.get("agent_id")
    if not agent_id:
        agent_id = await asyncio.to_thread(
            derive_agent_id_for_collections, fs, collection_ids
        )
    if not agent_id:
        return ORJSONResponse({"details": {}})

    collection_ids = await asyncio.to_thread(
        resolve_share_collection_ids, fs, collection_ids, agent_id
    )
    statuses_map = await asyncio.to_thread(fs.get_collection_statuses, collection_ids)
    stamp = make_freshness_stamp(statuses_map.values())
    bq = get_bq()
    core, *_ = await get_or_build_core(bq, agent_id, collection_ids, stamp)
    return ORJSONResponse(
        {"details": build_post_details(core["posts"], body.post_ids)}
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
