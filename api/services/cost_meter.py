"""Centralised cost telemetry - one row per paid external call.

Use :func:`log_cost` from every site that hits a metered third-party API
(Gemini, Apify, BrightData, X, Vetric, BigQuery, GCS). The function:

  1. Looks up the per-call cost via :mod:`config.cost_rates`, or accepts an
     explicit ``provider_reported_cost_usd`` for providers (Apify) that
     return the exact cost themselves.
  2. Builds a row matching the extended ``usage_events`` schema.
  3. Streams it to BigQuery on a daemon thread - failures are logged but
     **never** propagate to the caller.

Pairing with the originating user request: the current ``X-Request-ID``
ContextVar (set by :mod:`api.middleware.request_id`) is captured
automatically. Callers may pass ``request_id=`` explicitly when running
outside an HTTP request (e.g. CLI worker scripts).
"""

from __future__ import annotations

import contextvars
import json
import logging
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from config.cost_rates import compute_cost_micros

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Collection-owner context - set by long-running workers (pipeline runner,
# enrichment, topic clusterer) at the start of processing one collection so
# the many downstream Gemini calls in the same job can attribute cost to the
# right user / org / collection without each helper threading the params
# through every function. Cleared on exit.
# ---------------------------------------------------------------------------


_collection_context: ContextVar[dict[str, Any] | None] = ContextVar(
    "cost_meter_collection_context", default=None,
)


def set_collection_context(
    *,
    user_id: str | None = None,
    org_id: str | None = None,
    collection_id: str | None = None,
    agent_id: str | None = None,
):
    """Bind the current collection-owner context.

    Returns the contextvar token; pass to :func:`reset_collection_context`
    in a ``finally`` block, or use as a ``with`` block via
    :class:`collection_context_scope`.
    """
    return _collection_context.set(
        {
            "user_id": user_id or "",
            "org_id": org_id,
            "collection_id": collection_id,
            "agent_id": agent_id,
        }
    )


def reset_collection_context(token) -> None:
    """Restore the previous collection-owner context."""
    _collection_context.reset(token)


def get_collection_context() -> dict[str, Any]:
    """Return the bound collection context or an empty dict outside a scope."""
    return _collection_context.get() or {}


class collection_context_scope:
    """Context manager flavor of :func:`set_collection_context`.

    Usage::

        with collection_context_scope(user_id=u, collection_id=c):
            ...  # all log_cost / log_gemini_response calls inherit these.
    """

    def __init__(self, **kwargs: Any) -> None:
        self._kwargs = kwargs
        self._token = None

    def __enter__(self) -> "collection_context_scope":
        self._token = set_collection_context(**self._kwargs)
        return self

    def __exit__(self, *_exc) -> None:
        if self._token is not None:
            reset_collection_context(self._token)


# Event types used for cost rows (legacy event types still write via
# api/services/usage_service.py and remain unchanged).
EVENT_LLM = "llm_call"
EVENT_PROVIDER = "provider_call"
EVENT_BQ = "bq_query"
EVENT_GCS = "gcs_op"


# Cost-source labels (written to usage_events.cost_source so the admin UI can
# tell apart "this is what the provider actually charged us" from "we estimated
# because the provider didn't report a number" from "we looked it up in our
# rate table"). Keep the set small + stable - frontend renders by string.
COST_SOURCE_PROVIDER_REPORTED = "provider_reported"   # apify run.usageTotalUsd, etc.
COST_SOURCE_RATE_TABLE = "rate_table"                 # gemini tokens, brightdata $/record
COST_SOURCE_ESTIMATED_FALLBACK = "estimated_fallback" # provider went silent → assumed_per_post


# ---------------------------------------------------------------------------
# ContextVar propagation across thread boundaries
# ---------------------------------------------------------------------------
#
# `threading.Thread` does NOT inherit ContextVars from the parent thread -
# the child starts with a fresh, default context. That silently drops the
# cost-meter user_id / org_id / collection_id / agent_id binding the
# worker (workers/server.py) carefully set up, so every priced event
# fired from a child thread (apify adapter pool, pipeline step worker,
# etc.) lands as "unattributed" / "Unassigned".
#
# Use these helpers at every thread-spawn / executor.submit site that
# leads to a `log_cost` / `log_gemini_response` call. They snapshot the
# parent's context and `Context.run()` the target inside the snapshot in
# the child thread, so attribution carries through.


def start_thread_with_cost_context(
    target,
    *,
    args: tuple = (),
    kwargs: dict | None = None,
    name: str | None = None,
    daemon: bool = True,
) -> threading.Thread:
    """Spawn a ``Thread`` that runs ``target`` inside a snapshot of the
    current contextvar context - propagates cost-meter attribution
    (and ``X-Request-ID``) across thread boundaries.

    Drop-in replacement for ``threading.Thread(target=..., args=..., ...)``
    at every spawn site whose target may eventually call :func:`log_cost`
    or :func:`log_gemini_response`. Without it, the child thread sees
    empty contextvars and priced rows land as ``user_id="" agent_id=NULL``.
    """
    ctx = contextvars.copy_context()
    kwargs = kwargs or {}

    def _runner() -> None:
        ctx.run(target, *args, **kwargs)

    t = threading.Thread(target=_runner, name=name, daemon=daemon)
    return t


def submit_with_cost_context(executor, target, /, *args, **kwargs):
    """``executor.submit(target, *args, **kwargs)`` that propagates the
    current contextvar context into the pool worker thread.

    Use instead of bare ``pool.submit(fn, ...)`` whenever the submitted
    callable might log cost - otherwise the futures execute with empty
    cost-meter context and rows lose user / agent attribution.
    """
    ctx = contextvars.copy_context()
    return executor.submit(ctx.run, target, *args, **kwargs)


def log_cost(
    *,
    provider: str,
    user_id: str,
    feature: str,
    event_type: str = EVENT_PROVIDER,
    model: str | None = None,
    sub_kind: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_tokens: int = 0,
    units: int = 0,
    unit_kind: str | None = None,
    provider_reported_cost_usd: float | None = None,
    bytes_processed: int = 0,
    cost_micros_override: int | None = None,
    org_id: str | None = None,
    session_id: str | None = None,
    collection_id: str | None = None,
    agent_id: str | None = None,
    request_id: str | None = None,
    raw_provider_payload: dict | None = None,
    platform: str | None = None,
    cost_source: str | None = None,
) -> None:
    """Fire-and-forget logging of one paid external call.

    The call returns immediately; the BQ insert happens on a daemon thread.
    Any exception raised inside the insert is swallowed and logged so we
    never break a user request because telemetry hiccupped.

    When ``cost_micros_override`` is provided it bypasses the rate-table
    lookup. Use this for providers whose cost is computed by a
    specialised helper (e.g. Google Search Grounding via
    :func:`config.cost_rates.compute_grounding_cost_micros`).
    """
    # Normalize provider name once so the BQ column matches the rate-table
    # key (e.g. legacy "xapi" → canonical "x_api"). compute_cost_micros
    # already normalizes internally; we mirror it here so the persisted row
    # is consistent across all writers.
    try:
        from config.cost_rates import normalize_provider
        provider = normalize_provider(provider) or provider
    except Exception:
        pass

    # Inherit any unset attribution fields from the bound collection context.
    # Worker adapters (e.g. Apify in workers/collection/adapters/apify.py)
    # pass user_id="" because they don't know it directly - the runner binds
    # it via `collection_context_scope` at the entry. log_gemini_response
    # already does this fallback; doing it once here covers every caller.
    ctx = _collection_context.get() or {}
    if not user_id:
        user_id = ctx.get("user_id") or ""
    if org_id is None:
        org_id = ctx.get("org_id")
    if collection_id is None:
        collection_id = ctx.get("collection_id")
    if agent_id is None:
        agent_id = ctx.get("agent_id")

    # Resolve request_id from the current request scope if not supplied.
    if request_id is None:
        try:
            from api.middleware.request_id import get_request_id

            request_id = get_request_id()
        except Exception:
            request_id = None

    if cost_micros_override is not None:
        cost_micros: int | None = cost_micros_override
    else:
        try:
            cost_micros = compute_cost_micros(
                provider,
                model=model,
                sub_kind=sub_kind,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cached_tokens=cached_tokens,
                units=units,
                unit_kind=unit_kind,
                provider_reported_cost_usd=provider_reported_cost_usd,
                bytes_processed=bytes_processed,
                platform=platform,
            )
        except Exception:
            # Cost computation must never block the row. NULL cost is preferred
            # over no row at all - we can backfill from raw payload later.
            logger.warning(
                "cost_meter: compute_cost_micros failed for provider=%s model=%s",
                provider, model, exc_info=True,
            )
            cost_micros = None

    if cost_micros is None:
        logger.info(
            "cost_meter: NULL cost for provider=%s model=%s sub_kind=%s - rate table miss",
            provider, model, sub_kind,
        )

    # §E billed amount - what the user's wallet is actually debited: raw
    # provider cost × the admin-set profit margin. Stored alongside cost_micros
    # so the Finance page can report cost vs revenue. NULL when cost is NULL
    # (rate-table miss) - never block on telemetry.
    billed_micros: int | None = None
    if cost_micros is not None:
        try:
            from config.cost_rates import get_margin_multiplier

            billed_micros = int(round(cost_micros * get_margin_multiplier()))
        except Exception:
            logger.warning("cost_meter: margin lookup failed - billing at cost", exc_info=True)
            billed_micros = cost_micros

    # Safety net: a priced event with no user_id is cost we can't attribute or
    # bill. It shouldn't happen - surface it loudly so the gap gets fixed at the
    # call site (e.g. an LLM call outside a request/collection context).
    if cost_micros and not user_id:
        logger.warning(
            "cost_meter: priced event has NO user_id - unattributed cost "
            "(provider=%s model=%s feature=%s)", provider, model, feature,
        )

    metadata: dict[str, Any] = {}
    if raw_provider_payload is not None:
        # Cap raw payload size - provider responses can be huge and BQ has
        # row size limits. Trim to a JSON-string ~64 KB.
        try:
            payload_str = json.dumps(raw_provider_payload, default=str)
            if len(payload_str) > 64_000:
                payload_str = payload_str[:64_000] + "...<truncated>"
            metadata["raw"] = payload_str
        except Exception:
            logger.debug("cost_meter: could not serialise raw_provider_payload", exc_info=True)

    # Default cost_source: providers that report exact cost (apify) pass
    # `provider_reported_cost_usd`; everyone else looked it up in the rate
    # table. Callers can pin a stricter label (e.g. "estimated_fallback").
    if cost_source is None:
        if provider_reported_cost_usd is not None:
            cost_source = COST_SOURCE_PROVIDER_REPORTED
        elif cost_micros is not None:
            cost_source = COST_SOURCE_RATE_TABLE

    row: dict[str, Any] = {
        "event_id": str(uuid4()),
        "event_type": event_type,
        "user_id": user_id,
        "org_id": org_id,
        "session_id": session_id,
        "collection_id": collection_id,
        "metadata": json.dumps(metadata) if metadata else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "model": model,
        "feature": feature,
        "input_tokens": int(input_tokens) if input_tokens else None,
        "output_tokens": int(output_tokens) if output_tokens else None,
        "cached_tokens": int(cached_tokens) if cached_tokens else None,
        "units": int(units) if units else None,
        "unit_kind": unit_kind,
        "cost_micros": cost_micros,
        "billed_micros": billed_micros,
        "agent_id": agent_id,
        "request_id": request_id,
        "platform": platform,
        "cost_source": cost_source,
    }

    def _insert() -> None:
        try:
            from api.deps import get_bq

            get_bq().insert_rows("usage_events", [row])
        except Exception:
            logger.warning(
                "cost_meter: BQ insert failed for provider=%s feature=%s",
                provider, feature, exc_info=True,
            )
        # §E: deduct the BILLED amount (cost × margin) from the user's prepaid
        # wallet (best-effort). BigQuery above stays the source of truth for
        # analytics/reconcile; the wallet counter is the fast balance the gate
        # reads. `free`-tier users are simply not enforced on balance, so
        # deducting them is harmless.
        if billed_micros and user_id:
            try:
                from api.deps import get_fs

                get_fs().apply_spend_micros(user_id, int(billed_micros))
            except Exception:
                logger.warning(
                    "cost_meter: wallet deduction failed for user=%s", user_id, exc_info=True,
                )

    threading.Thread(target=_insert, daemon=True).start()


# ---------------------------------------------------------------------------
# Convenience: log one Gemini round-trip given the SDK's response object.
# ---------------------------------------------------------------------------


def log_gemini_response(
    response: Any,
    *,
    feature: str,
    user_id: str | None = None,
    org_id: str | None = None,
    session_id: str | None = None,
    collection_id: str | None = None,
    agent_id: str | None = None,
    model: str | None = None,
    platform: str | None = None,
) -> None:
    """Extract ``usage_metadata`` from a ``google-genai`` response and log
    one ``llm_call`` cost row.

    Designed to be sprinkled after every direct ``client.models.generate_content``
    call site (ADK-mediated calls are captured by ``capture_llm_cost``).

    Caller may pass identity fields explicitly; missing ones are pulled from
    :func:`get_collection_context` (set by the pipeline runner) so worker
    code doesn't have to thread user_id through every helper. Never raises
    - telemetry failure must not break the surrounding feature.
    """
    try:
        usage = getattr(response, "usage_metadata", None)
        if usage is None:
            return

        prompt_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        candidates_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
        cached_tokens = int(getattr(usage, "cached_content_token_count", 0) or 0)
        thoughts_tokens = int(getattr(usage, "thoughts_token_count", 0) or 0)

        if prompt_tokens == 0 and candidates_tokens == 0 and thoughts_tokens == 0:
            return

        output_tokens = candidates_tokens + thoughts_tokens
        resolved_model = (
            model or getattr(response, "model_version", None) or ""
        )

        ctx = get_collection_context()
        log_cost(
            provider="gemini",
            user_id=user_id or ctx.get("user_id") or "",
            feature=feature,
            event_type=EVENT_LLM,
            model=resolved_model,
            input_tokens=prompt_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
            org_id=org_id or ctx.get("org_id"),
            session_id=session_id,
            collection_id=collection_id or ctx.get("collection_id"),
            agent_id=agent_id or ctx.get("agent_id"),
            platform=platform,
        )
    except Exception:
        logger.warning(
            "log_gemini_response failed (feature=%s)", feature, exc_info=True,
        )
