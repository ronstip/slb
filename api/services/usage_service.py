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
) -> None:
    """Record posts collected (called from worker after each batch).

    Pass ``provider`` (apify / brightdata / xapi / vetric / mock) so the
    event row can be split per provider for cost attribution. Legacy
    callers that don't yet pass provider will write NULL — fix at the
    call site, don't drop the row.
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
    )


def track_credit_purchase(
    user_id: str,
    org_id: str | None,
    credits: int,
    amount_cents: int,
    pack_id: str | None = None,
) -> None:
    """Record a credit purchase."""
    _log_event(
        "credit_purchase",
        user_id,
        org_id=org_id,
        metadata={"credits": credits, "amount_cents": amount_cents, "pack_id": pack_id},
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
) -> None:
    """Fire-and-forget BigQuery event logging.

    The extra cost-attribution columns (provider / feature / units /
    unit_kind / cost_micros) are nullable and only written when callers
    pass them. Legacy callers continue to work unchanged.

    When ``provider`` and ``units`` are set but ``cost_micros`` is not, we
    attempt a cost lookup via :func:`config.cost_rates.compute_cost_micros`
    using ``unit_kind`` as the sub-kind hint. A miss is silent (cost stays
    NULL) and the event is still written for product-level analytics.
    """
    # Capture request_id at call site, before we hop to a daemon thread —
    # ContextVar does not propagate across thread boundaries.
    request_id: str | None
    try:
        from api.middleware.request_id import get_request_id
        request_id = get_request_id()
    except Exception:
        request_id = None

    # Best-effort cost lookup when provider+units are known.
    if cost_micros is None and provider and units:
        try:
            from config.cost_rates import compute_cost_micros

            cost_micros = compute_cost_micros(
                provider, sub_kind=unit_kind, units=int(units),
            )
        except Exception:
            logger.debug(
                "cost_micros lookup failed for provider=%s unit_kind=%s",
                provider, unit_kind, exc_info=True,
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
                        "request_id": request_id,
                    }
                ],
            )
        except Exception:
            logger.warning("Failed to log usage event %s", event_type, exc_info=True)

    threading.Thread(target=_insert, daemon=True).start()
