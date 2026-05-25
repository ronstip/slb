"""Centralized usage tracking — wraps Firestore counters + BigQuery event log."""

import json
import logging
import threading
from datetime import datetime, timezone
from uuid import uuid4

from api.deps import get_fs

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Firestore counter helpers (real-time, user-facing usage)
# ---------------------------------------------------------------------------


def track_query(user_id: str, org_id: str | None, session_id: str | None = None) -> None:
    """Record a chat query (message sent to agent)."""
    fs = get_fs()
    fs.increment_usage(user_id, org_id, "queries_used", 1)
    _log_event("chat_message", user_id, org_id=org_id, session_id=session_id)


def track_collection_created(
    user_id: str,
    org_id: str | None,
    collection_id: str,
    session_id: str | None = None,
) -> None:
    """Record a collection creation."""
    fs = get_fs()
    fs.increment_usage(user_id, org_id, "collections_created", 1)
    _log_event(
        "collection_created",
        user_id,
        org_id=org_id,
        session_id=session_id,
        collection_id=collection_id,
    )


def track_posts_collected(
    user_id: str,
    org_id: str | None,
    collection_id: str,
    count: int,
    provider: str | None = None,
    agent_id: str | None = None,
    platform: str | None = None,
) -> None:
    """Record posts collected (called from worker after each batch).

    Pass ``provider`` (apify / brightdata / xapi / vetric / mock) so the
    event row can be split per provider for cost attribution. Pass
    ``agent_id`` so admin per-agent rollups can attribute the spend.
    Pass ``platform`` (instagram / facebook / tiktok / x / reddit / youtube)
    so the Finance page can render the platform × provider matrix —
    each (provider, platform) pair has its own rate (e.g. Apify charges
    differently for IG vs FB vs TikTok).
    """
    fs = get_fs()
    fs.increment_usage(user_id, org_id, "posts_collected", count)
    _log_event(
        "posts_collected",
        user_id,
        org_id=org_id,
        collection_id=collection_id,
        metadata={"count": count},
        provider=provider,
        units=count,
        unit_kind="posts",
        feature="scrape",
        agent_id=agent_id,
        platform=platform,
    )


def track_credit_purchase(
    user_id: str,
    amount_cents: int,
    amount_micros: int,
    provider_ref: str | None = None,
) -> None:
    """Record a $ prepaid top-up in the BQ event log (admin analytics)."""
    _log_event(
        "credit_purchase",
        user_id,
        metadata={"amount_cents": amount_cents, "amount_micros": amount_micros, "provider_ref": provider_ref},
    )


def track_tool_call(
    user_id: str,
    org_id: str | None,
    session_id: str | None = None,
    collection_id: str | None = None,
    tool_name: str = "",
    status: str = "ok",
) -> None:
    """Record an agent tool invocation."""
    _log_event(
        "tool_call",
        user_id,
        org_id=org_id,
        session_id=session_id,
        collection_id=collection_id,
        metadata={"tool_name": tool_name, "status": status},
    )


# ---------------------------------------------------------------------------
# BigQuery event log (fire-and-forget, for admin analytics)
# ---------------------------------------------------------------------------


def _log_event(
    event_type: str,
    user_id: str,
    org_id: str | None = None,
    session_id: str | None = None,
    collection_id: str | None = None,
    metadata: dict | None = None,
    provider: str | None = None,
    feature: str | None = None,
    units: int | None = None,
    unit_kind: str | None = None,
    cost_micros: int | None = None,
    agent_id: str | None = None,
    platform: str | None = None,
) -> None:
    """Fire-and-forget BigQuery event logging.

    The extra cost-attribution columns (provider / feature / units /
    unit_kind / cost_micros / agent_id) are nullable and only written when
    callers pass them. Legacy callers continue to work unchanged.

    When ``provider`` and ``units`` are set but ``cost_micros`` is not, we
    attempt a cost lookup via :func:`config.cost_rates.compute_cost_micros`
    using ``unit_kind`` as the sub-kind hint. A miss is silent (cost stays
    NULL) and the event is still written for product-level analytics.

    ``agent_id`` falls back to the bound cost_meter collection context so
    worker call sites that already use ``collection_context_scope`` get
    correct attribution without threading the id through every helper.
    """
    # Capture request_id at call site, before we hop to a daemon thread —
    # ContextVar does not propagate across thread boundaries.
    request_id: str | None
    try:
        from api.middleware.request_id import get_request_id
        request_id = get_request_id()
    except Exception:
        request_id = None

    # Fall back to bound collection context for agent_id — same pattern as
    # cost_meter.log_cost uses, so worker writes inherit the run's agent.
    if not agent_id:
        try:
            from api.services.cost_meter import _collection_context  # type: ignore
            ctx = _collection_context.get()
            if ctx:
                agent_id = ctx.get("agent_id") or None
        except Exception:
            pass

    # Normalize provider name once — keeps the BQ column consistent with the
    # rate-table key (e.g. legacy "xapi" → canonical "x_api").
    try:
        from config.cost_rates import normalize_provider
        provider = normalize_provider(provider)
    except Exception:
        pass

    # Best-effort cost lookup when provider+units are known. Pass
    # ``platform`` through so the per-(provider, platform) scraper-rate
    # matrix (configurable via the admin Pricing editor) wins over the
    # legacy single-rate-table entries.
    cost_source: str | None = None
    if cost_micros is None and provider and units:
        try:
            from config.cost_rates import compute_cost_micros

            cost_micros = compute_cost_micros(
                provider, sub_kind=unit_kind, units=int(units), platform=platform,
            )
            if cost_micros is not None:
                cost_source = "rate_table"
        except Exception:
            logger.debug(
                "cost_micros lookup failed for provider=%s unit_kind=%s platform=%s",
                provider, unit_kind, platform, exc_info=True,
            )

    def _insert() -> None:
        try:
            from api.deps import get_bq

            bq = get_bq()
            bq.insert_rows(
                "usage_events",
                [
                    {
                        "event_id": str(uuid4()),
                        "event_type": event_type,
                        "user_id": user_id,
                        "org_id": org_id,
                        "session_id": session_id,
                        "collection_id": collection_id,
                        "metadata": json.dumps(metadata) if metadata else None,
                        "provider": provider,
                        "feature": feature,
                        "units": units,
                        "unit_kind": unit_kind,
                        "cost_micros": cost_micros,
                        "agent_id": agent_id,
                        "request_id": request_id,
                        "platform": platform,
                        "cost_source": cost_source,
                    }
                ],
            )
        except Exception:
            logger.warning("Failed to log usage event %s", event_type, exc_info=True)

    threading.Thread(target=_insert, daemon=True).start()
