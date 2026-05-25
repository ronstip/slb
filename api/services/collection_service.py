"""Shared collection creation logic used by both the agent tool and the REST API."""

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from api.auth.dependencies import CurrentUser
from api.deps import get_bq, get_fs
from api.schemas.requests import CreateCollectionRequest
from api.services.cost_estimate import estimate_run_cost_micros
from api.services.entitlements import require_credit_for_run
from api.schemas.responses import (
    BreakdownItem,
    CollectionStatsResponse,
    DailyVolumeItem,
    EngagementStats,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)


def estimate_request_micros(request: CreateCollectionRequest) -> int:
    """Conservative pre-flight $ estimate (USD micros) for one collection request.

    Shared by the per-collection gate and the agent-run sum check so both use
    identical assumptions.
    """
    providers: list[str] | None = None
    if request.vendor_config:
        vc = request.vendor_config
        provs = set((vc.platform_overrides or {}).values())
        provs.add(vc.default)
        providers = ["x_api" if p == "xapi" else p for p in provs]
    return estimate_run_cost_micros(
        n_posts=request.n_posts,
        providers=providers,
        include_comments=request.include_comments,
        enrichment_enabled=True,
    )


def can_access_agent(user: CurrentUser, agent: dict) -> bool:
    """Access rule for an agent (the unit of org sharing).

    The owner always has access. Other org members have access only when the
    owner has explicitly shared the agent (`visibility == "org"`). Sharing is
    opt-in: an absent/`"private"` visibility means org members see nothing —
    this is the single source of truth replacing the old per-collection share.
    """
    if agent.get("user_id") == user.uid:
        return True
    if (
        user.org_id
        and agent.get("org_id") == user.org_id
        and agent.get("visibility") == "org"
    ):
        return True
    return False


def can_access_collection(user: CurrentUser, collection_status: dict) -> bool:
    """Owner or org-member (when visibility=='org') can access the collection.

    Collection `visibility` is no longer set by the user directly; it is
    propagated from the owning agent's `visibility` (see
    `agent_service.set_agent_visibility`). The check itself is unchanged so all
    existing call sites (feed, posts, dashboard, …) keep working.
    """
    if collection_status.get("user_id") == user.uid:
        return True
    if (
        user.org_id
        and collection_status.get("org_id") == user.org_id
        and collection_status.get("visibility") == "org"
    ):
        return True
    return False


def signature_to_response(data: dict) -> CollectionStatsResponse:
    """Convert a raw statistical signature dict to CollectionStatsResponse."""
    eng = data.get("engagement_summary") or {}
    return CollectionStatsResponse(
        computed_at=data.get("computed_at"),
        collection_status_at_compute=data.get("collection_status_at_compute"),
        total_posts=data.get("total_posts", 0),
        total_unique_channels=data.get("total_unique_channels", 0),
        date_range=data.get("date_range", {}),
        platform_breakdown=[BreakdownItem(**x) for x in data.get("platform_breakdown", [])],
        sentiment_breakdown=[BreakdownItem(**x) for x in data.get("sentiment_breakdown", [])],
        top_themes=[BreakdownItem(**x) for x in data.get("top_themes", [])],
        top_entities=[BreakdownItem(**x) for x in data.get("top_entities", [])],
        language_breakdown=[BreakdownItem(**x) for x in data.get("language_breakdown", [])],
        content_type_breakdown=[BreakdownItem(**x) for x in data.get("content_type_breakdown", [])],
        negative_sentiment_pct=data.get("negative_sentiment_pct"),
        total_posts_enriched=data.get("total_posts_enriched", 0),
        daily_volume=[DailyVolumeItem(**x) for x in data.get("daily_volume", [])],
        engagement_summary=EngagementStats(**eng) if eng else EngagementStats(),
    )


def create_collection_from_request(
    request: CreateCollectionRequest,
    user_id: str,
    org_id: str | None = None,
    session_id: str = "",
    extra_config: dict | None = None,
) -> dict:
    """Create a collection, insert records, and dispatch the worker.

    Used by both the REST endpoint and the agent start_collection tool.
    """
    settings = get_settings()
    bq = get_bq()
    fs = get_fs()

    collection_id = str(uuid4())

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=request.time_range_days)

    config = {
        "platforms": request.platforms,
        "keywords": request.keywords,
        "channel_urls": request.channel_urls or [],
        "time_range": {
            "start": start_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "n_posts": request.n_posts,
        "max_posts_per_keyword": (
            __import__("math").ceil(request.n_posts / (max(len(request.platforms), 1) * max(len(request.keywords), 1)))
            if request.n_posts > 0 else None
        ),
        "include_comments": request.include_comments,
        "geo_scope": request.geo_scope,
    }
    if request.vendor_config:
        config["vendor_config"] = request.vendor_config.model_dump(exclude_none=True)
    if extra_config:
        config.update(extra_config)

    # Pull enrichment config from request (frontend direct-start path).
    # setdefault so extra_config (agent path) takes precedence.
    if request.custom_fields:
        config.setdefault("custom_fields", request.custom_fields)
    if request.video_params:
        config.setdefault("video_params", request.video_params)
    if request.reasoning_level:
        config.setdefault("reasoning_level", request.reasoning_level)
    if request.min_likes is not None:
        config.setdefault("min_likes", request.min_likes)
    if request.has_media is not None:
        config.setdefault("has_media", request.has_media)

    # §E pre-flight credit gate. Estimate the run's $ cost up front and refuse
    # (402) if the wallet can't cover it, so a run never dies mid-way and wastes
    # credit. No-op unless entitlements mode is on; `free` users always pass.
    require_credit_for_run(user_id, estimate_request_micros(request))

    # Insert collection record into BigQuery
    bq.insert_rows(
        "collections",
        [
            {
                "collection_id": collection_id,
                "user_id": user_id,
                "org_id": org_id,
                "session_id": session_id,
                "original_question": request.description,
                "config": json.dumps(config),
                "time_range_start": start_date.isoformat(),
                "time_range_end": end_date.isoformat(),
            }
        ],
    )

    # Create Firestore status document
    fs.create_collection_status(collection_id, user_id, config, org_id=org_id)

    # Track usage
    from api.services.usage_service import track_collection_created
    track_collection_created(user_id, org_id, collection_id, session_id=session_id)

    # Dispatch worker
    if settings.is_dev:
        logger.info(
            "DEV MODE: Running collection pipeline in background thread for %s",
            collection_id,
        )
        from workers.pipeline import run_pipeline
        from api.services.cost_meter import collection_context_scope

        # Bind the cost-meter context INSIDE the thread (contextvars don't cross
        # thread boundaries). The prod path binds this in workers/server.py via
        # Cloud Tasks; the dev thread bypasses that, so without this every
        # enrich/topic_cluster Gemini call would log cost with an empty user_id.
        agent_id_ctx = (extra_config or {}).get("agent_id")

        def _run_pipeline_with_cost_context() -> None:
            with collection_context_scope(
                user_id=user_id, org_id=org_id,
                collection_id=collection_id, agent_id=agent_id_ctx,
            ):
                run_pipeline(collection_id)

        thread = threading.Thread(
            target=_run_pipeline_with_cost_context,
            daemon=True,
        )
        thread.start()
    else:
        _dispatch_cloud_task(settings, collection_id)

    return {
        "collection_id": collection_id,
        "status": "pending",
        "config": config,
    }



def _dispatch_cloud_task(settings, collection_id: str) -> None:
    """Dispatch collection worker via Cloud Tasks."""
    from api.services.cloud_tasks import dispatch_worker_task

    dispatch_worker_task("/collection/run", {"collection_id": collection_id})
    logger.info("Dispatched collection task for %s", collection_id)
