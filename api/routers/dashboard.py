"""Dashboard router - serves denormalized post data for client-side interactive dashboards."""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import ORJSONResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.requests import DashboardAggregateRequest, DashboardDataRequest, PostDetailsRequest
from api.schemas.responses import DashboardDataResponse, DashboardKpis
from api.services.dashboard_aggregate import (
    build_feed_data_map,
    build_table_data_map,
    build_widget_data_map,
)
from api.services.dashboard_cache import (
    get_studio_agg,
    make_freshness_stamp,
    perf_logger,
    set_studio_agg,
)
from api.services.dashboard_scope import apply_filters, intersect_with_scope
from api.services.dashboard_response import data_cache_key, gzipped_json_response
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

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _can_access_collection(user: CurrentUser, status: dict) -> bool:
    if status.get("user_id") == user.uid:
        return True
    if (
        user.org_id
        and status.get("org_id") == user.org_id
        and status.get("visibility") == "org"
    ):
        return True
    return False


@router.post("/data", response_model=DashboardDataResponse)
async def get_dashboard_data(
    request: DashboardDataRequest,
    http_request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Fetch all posts (denormalized) for client-side dashboard filtering."""
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="collection_ids is required")

    fs = get_fs()

    # Validate access for each collection. Run in parallel - the previous
    # sequential loop did N synchronous Firestore reads on the asyncio loop,
    # blocking every other request and adding one round-trip per collection.
    statuses = await asyncio.gather(
        *(asyncio.to_thread(fs.get_collection_status, cid) for cid in request.collection_ids)
    )
    for cid, status in zip(request.collection_ids, statuses):
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()

    # Resolve agent context: explicit > derived from collections.
    agent_id = request.agent_id or derive_agent_id_for_collections(
        fs, request.collection_ids
    )

    # No agent context = collections never linked to an agent. We return an
    # empty dataset with collection names, since there's no agent-scoped view
    # to render. (Manual / pre-agent collections are not queryable here.)
    if not agent_id:
        name_rows = await asyncio.to_thread(
            bq.query, COLLECTION_NAMES_SQL, {"collection_ids": request.collection_ids}
        )
        collection_names = {
            r["collection_id"]: r.get("original_question", r["collection_id"])
            for r in name_rows
        }
        return DashboardDataResponse(
            posts=[],
            topics=[],
            collection_names=collection_names,
            truncated=False,
            kpis=DashboardKpis(
                total_posts=0, total_views=0, total_likes=0,
                total_comments=0, total_shares=0,
            ),
        )

    # Passive-invalidation response cache. The stamp is the max
    # collection_status.updated_at across the (already-fetched) statuses, which
    # the pipeline bumps when post counts change - so the cache busts exactly
    # when this agent's data changes and otherwise serves the assembled payload
    # without touching BigQuery. See api/services/dashboard_cache.py.
    stamp = make_freshness_stamp(statuses)
    core, cache_hit, gather_ms, serialize_ms = await get_or_build_core(
        bq, agent_id, request.collection_ids, stamp
    )

    perf_logger.info(
        "dashboard.data agent=%s cols=%d cache=%s posts=%d gather_ms=%.0f serialize_ms=%.0f",
        agent_id, len(request.collection_ids), "HIT" if cache_hit else "MISS",
        len(core["posts"]), gather_ms, serialize_ms,
    )

    # Apply the report-level transform (canonicalization + computed fields) on
    # top of the cached core. The cache holds RAW posts keyed by data freshness,
    # so a live-edit recompute with a new report_config reuses it without
    # re-querying BigQuery. Canonicalization only moves value-level counts, so
    # the post-level KPIs are unaffected and need no recompute.
    config: dict | None = None
    posts = core["posts"]
    if request.report_config is not None:
        config = request.report_config.model_dump(exclude_none=True, by_alias=True)
        errors = validate_report_config(config)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        posts = transform_posts(posts, config)

    # Slim mode drops the heavy display-only fields; the client lazy-fetches them
    # per visible post via /dashboard/post-details (served from the same cache).
    if request.slim:
        posts = strip_detail_fields(posts)

    # Return the cached/assembled core directly (already matches
    # DashboardDataResponse) via orjson, skipping a second per-row validation.
    # Gzip-capable clients are served the compressed body from the
    # response-bytes cache (keyed by data freshness + config + slim), so a warm
    # hit skips both orjson and gzip - the bulk of warm CPU on a large payload.
    body = {**core, "posts": posts}
    cache_key = data_cache_key(
        agent_id, request.collection_ids, stamp, config, request.slim
    )
    return gzipped_json_response(
        body, cache_key, http_request.headers.get("accept-encoding", "")
    )


@router.post("/post-details")
async def get_dashboard_post_details(
    request: PostDetailsRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Lazy-load the display-only fields (ai_summary/context/media_refs) for the
    bounded set of posts currently on screen. Served from the same cached core
    as /dashboard/data, so a warm dashboard answers without touching BigQuery.
    """
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="collection_ids is required")
    if not request.post_ids:
        return ORJSONResponse({"details": {}})
    if len(request.post_ids) > 2000:
        raise HTTPException(status_code=400, detail="too many post_ids (max 2000)")

    fs = get_fs()
    statuses = await asyncio.gather(
        *(asyncio.to_thread(fs.get_collection_status, cid) for cid in request.collection_ids)
    )
    for cid, status in zip(request.collection_ids, statuses):
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    agent_id = request.agent_id or derive_agent_id_for_collections(
        fs, request.collection_ids
    )
    if not agent_id:
        return ORJSONResponse({"details": {}})

    stamp = make_freshness_stamp(statuses)
    bq = get_bq()
    core, *_ = await get_or_build_core(bq, agent_id, request.collection_ids, stamp)
    return ORJSONResponse({"details": build_post_details(core["posts"], request.post_ids)})


@router.post("/aggregate")
async def get_dashboard_aggregate(
    request: DashboardAggregateRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Server-side widget aggregation for the studio (interactive) path.

    The client sends the *effective* filter state (viewer filters already
    intersected with reportScope on the FE) and the current widget layout.
    The server applies those filters to the cached posts, aggregates every
    eligible widget, and returns compact widget data — the same shapes the FE
    widgets already consume (`serverData`/`serverTableRows`/`serverPostIds`).
    Widgets the engine can't reproduce are absent from the response and keep
    client-side aggregation, so the response is always a strict superset.

    Results are cached per (agent, collections, freshness stamp, agg signature)
    where the signature is a hash of the effective filters + layout widget
    configs. Cache misses are fast: the post set lives in the dashboard core
    cache (no BQ round-trip on a warm dashboard).
    """
    import hashlib
    import json

    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="collection_ids is required")

    fs = get_fs()
    statuses = await asyncio.gather(
        *(asyncio.to_thread(fs.get_collection_status, cid) for cid in request.collection_ids)
    )
    for cid, status in zip(request.collection_ids, statuses):
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()
    agent_id = request.agent_id or derive_agent_id_for_collections(
        fs, request.collection_ids
    )
    if not agent_id:
        return ORJSONResponse({"widgetData": {}, "tableData": {}, "feedData": {}})

    stamp = make_freshness_stamp(statuses)
    core, cache_hit, gather_ms, _serialize_ms = await get_or_build_core(
        bq, agent_id, request.collection_ids, stamp
    )

    config: dict | None = None
    if request.report_config is not None:
        config = request.report_config.model_dump(exclude_none=True, by_alias=True)
        errors = validate_report_config(config)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))

    # Build the agg signature so repeated filter combos are served from cache.
    # Include filter state, per-widget configs (not layout positions), and
    # report_config. Exclude x/y/w/h/layout-only fields to avoid cache busting
    # on mere drag-resizes with no data change.
    _LAYOUT_ONLY = frozenset({"x", "y", "w", "h", "minW", "maxW", "minH", "maxH", "moved", "static", "isDraggable", "isResizable"})
    slim_layout = [
        {k: v for k, v in w.items() if k not in _LAYOUT_ONLY}
        for w in request.layout
    ]
    sig_payload = {
        "f": request.filters,
        "lw": slim_layout,
        "rc": config or {},
    }
    agg_sig = hashlib.md5(
        json.dumps(sig_payload, sort_keys=True, default=str).encode()
    ).hexdigest()

    cached = await asyncio.to_thread(
        get_studio_agg, agent_id, request.collection_ids, stamp, agg_sig
    )
    if cached is not None:
        perf_logger.info(
            "dashboard.aggregate agent=%s cache=HIT gather_ms=%.0f",
            agent_id, gather_ms,
        )
        return ORJSONResponse(cached)

    # Apply report-level transform (canonicalization + computed fields).
    posts = core["posts"]
    if config:
        posts = transform_posts(posts, config)

    # Apply the effective filters (viewer selection already intersected with
    # reportScope on the FE) to reproduce `filteredPosts` on the server.
    # `filtered_posts` is also the percent baseline (`basePosts` in the FE),
    # matching `basePosts={filteredPosts}` in SocialDashboardGrid.
    filtered_posts = await asyncio.to_thread(apply_filters, posts, request.filters or None)

    # Build per-widget aggregates over the filtered set.
    def _build():
        wd = build_widget_data_map(filtered_posts, request.layout)
        td = build_table_data_map(filtered_posts, request.layout)
        fd_full = build_feed_data_map(filtered_posts, request.layout)
        # Return post-id lists (not full post dicts) for feed widgets, matching
        # the share path's `feedData` shape.
        fd = {wid: [p["post_id"] for p in plist] for wid, plist in fd_full.items()}
        return {"widgetData": wd, "tableData": td, "feedData": fd}

    result = await asyncio.to_thread(_build)

    perf_logger.info(
        "dashboard.aggregate agent=%s cache=MISS core_hit=%s posts=%d filtered=%d gather_ms=%.0f widgets=%d",
        agent_id, cache_hit, len(posts), len(filtered_posts), gather_ms, len(request.layout),
    )

    await asyncio.to_thread(
        set_studio_agg, agent_id, request.collection_ids, stamp, agg_sig, result
    )
    return ORJSONResponse(result)


# ---------------------------------------------------------------------------
# Widget annotation compose - one-shot Gemini call that drafts a figure-style
# header or caption for a dashboard widget. Mirrors the single-call pattern
# used by topics narrative + session naming. Not cached; the user re-clicks
# to regenerate.
# ---------------------------------------------------------------------------


class _WidgetSnapshot(BaseModel):
    title: str | None = None
    description: str | None = None
    chart_type: str | None = None
    aggregation: str | None = None
    custom_config: dict | None = None
    filters: dict | None = None
    figure_header: str | None = None
    figure_text: str | None = None


class _BucketStat(BaseModel):
    label: str
    value: float


class _DataSummary(BaseModel):
    post_count: int = 0
    time_range: dict | None = None
    metric_label: str | None = None
    dimension_label: str | None = None
    top_buckets: list[_BucketStat] = Field(default_factory=list)
    kpi_value: float | None = None
    top_sentiments: list[_BucketStat] = Field(default_factory=list)
    top_platforms: list[_BucketStat] = Field(default_factory=list)


class ComposeFieldRequest(BaseModel):
    target: Literal["header", "figure_text"]
    widget: _WidgetSnapshot
    data_summary: _DataSummary
    agent_id: str | None = None


class ComposeFieldResponse(BaseModel):
    text: str


_HEADER_INSTRUCTIONS = (
    "Write a terse 4–8 word descriptive header for this chart. Sentence case, "
    "no trailing period, no quotes. It should label what the chart shows, not "
    "summarize the takeaway. Reply with ONLY the header text."
)

_FIGURE_TEXT_INSTRUCTIONS = (
    "Write a 1–2 sentence figure caption in the style of an academic paper. "
    "Combine BOTH the methodology (what is being shown - dimension, metric, "
    "sample size, time window) AND the primary takeaway visible in the data. "
    "Past tense, factual, no hedging, no marketing language, no bullets. "
    "Reply with ONLY the caption text."
)


def _format_bucket_list(buckets: list[_BucketStat], limit: int = 8) -> str:
    if not buckets:
        return "  (none)"
    return "\n".join(
        f"  - {b.label}: {b.value:g}" for b in buckets[:limit]
    )


def _build_compose_prompt(req: ComposeFieldRequest, task_context: dict | None) -> str:
    w = req.widget
    s = req.data_summary

    parts: list[str] = []

    if task_context:
        title = task_context.get("title") or ""
        context = task_context.get("context") or ""
        parts.append("Research task:")
        if title:
            parts.append(f"  Title: {title}")
        if context:
            # Cap context to keep prompt tight
            parts.append(f"  Context: {context[:600]}")
        parts.append("")

    parts.append("Chart:")
    if w.title:
        parts.append(f"  Widget title (card chrome): {w.title}")
    if w.description:
        parts.append(f"  Widget subtitle: {w.description}")
    if w.chart_type:
        parts.append(f"  Chart type: {w.chart_type}")
    if w.aggregation:
        parts.append(f"  Aggregation: {w.aggregation}")
    if w.custom_config:
        parts.append(f"  Config: {w.custom_config}")
    if w.filters:
        parts.append(f"  Widget filters: {w.filters}")

    # If composing one field, surface the other so the two stay consistent.
    if req.target == "header" and w.figure_text:
        parts.append(f"  Existing figure caption: {w.figure_text}")
    if req.target == "figure_text" and w.figure_header:
        parts.append(f"  Existing figure header: {w.figure_header}")
    parts.append("")

    parts.append("Data summary:")
    parts.append(f"  Post count (after filters): {s.post_count}")
    if s.time_range:
        rng_from = s.time_range.get("from") or "?"
        rng_to = s.time_range.get("to") or "?"
        parts.append(f"  Time range: {rng_from} → {rng_to}")
    if s.metric_label:
        parts.append(f"  Metric: {s.metric_label}")
    if s.dimension_label:
        parts.append(f"  Grouped by: {s.dimension_label}")
    if s.kpi_value is not None:
        parts.append(f"  KPI value: {s.kpi_value:g}")
    if s.top_buckets:
        parts.append("  Top buckets:")
        parts.append(_format_bucket_list(s.top_buckets))
    if s.top_platforms:
        parts.append("  Top platforms (overall):")
        parts.append(_format_bucket_list(s.top_platforms, limit=5))
    if s.top_sentiments:
        parts.append("  Sentiment mix (overall):")
        parts.append(_format_bucket_list(s.top_sentiments, limit=5))
    parts.append("")

    instructions = (
        _HEADER_INSTRUCTIONS if req.target == "header" else _FIGURE_TEXT_INSTRUCTIONS
    )
    parts.append(instructions)

    return "\n".join(parts)


def _load_task_context(fs, user: CurrentUser, agent_id: str) -> dict | None:
    """Fetch task title + context from the agent doc, with access check.
    Returns None on missing access or missing doc - composition still works
    without task context, just with less grounding."""
    try:
        agent = fs.get_agent(agent_id)
    except Exception:
        logger.exception("Failed to load agent %s for compose context", agent_id)
        return None
    if not agent:
        return None
    if agent.get("user_id") != user.uid and (
        not user.org_id or agent.get("org_id") != user.org_id
    ):
        return None
    return {
        "title": agent.get("title") or "",
        "context": agent.get("context") or "",
    }


@router.post("/widget/compose-field", response_model=ComposeFieldResponse)
async def compose_widget_field(
    req: ComposeFieldRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Draft a figure-style header or caption for a dashboard widget.

    Single non-streaming Gemini Flash call. Returns the generated text; the
    client decides whether to accept it.
    """
    settings = get_settings()
    fs = get_fs()

    task_context = (
        _load_task_context(fs, user, req.agent_id) if req.agent_id else None
    )
    prompt = _build_compose_prompt(req, task_context)

    def _call() -> str:
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gemini_location,
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.6,
                max_output_tokens=256,
                # Gemini 3 Flash spends ~240 thinking tokens by default, which
                # exhausts the budget before any visible text is emitted on
                # short utility prompts. Disable thinking for this one-shot.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )

        from api.services.cost_meter import log_gemini_response

        log_gemini_response(
            response,
            feature="dashboard_gen",
            model=settings.gemini_model,
            user_id=user.uid,
            agent_id=req.agent_id,
        )

        return (response.text or "").strip()

    try:
        text = await asyncio.to_thread(_call)
    except Exception:
        logger.exception("Widget field compose failed (target=%s)", req.target)
        raise HTTPException(status_code=502, detail="Compose failed")

    # Strip wrapping quotes the model sometimes adds for short outputs.
    text = text.strip().strip('"').strip("'").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Empty compose result")
    return ComposeFieldResponse(text=text)
