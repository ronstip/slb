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
) -> None:
    """Record posts collected (called from worker after each batch)."""
    fs = get_fs()
    fs.increment_usage(user_id, org_id, "posts_collected", count)
    _log_event(
        "posts_collected",
        user_id,
        org_id=org_id,
        collection_id=collection_id,
        metadata={"count": count},
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
) -> None:
    """Fire-and-forget BigQuery event logging."""

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
                    }
                ],
            )
        except Exception:
            logger.warning("Failed to log usage event %s", event_type, exc_info=True)

    threading.Thread(target=_insert, daemon=True).start()
