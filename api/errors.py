"""Global exception handling — keeps tracebacks out of HTTP responses.

Unhandled exceptions used to surface as raw ``str(e)`` strings in 500 bodies
(see the audit in PRODUCTION_PLAN.md §B.2). This handler is the safety net
that gives clients a stable shape — ``{"error": "internal_error", "request_id"}``
— while the real trace lands in Cloud Logging tagged with the same id.

Inline ``HTTPException`` raises in routers are unaffected: FastAPI has its own
``HTTPException`` handler that runs first, so this handler only fires for the
truly *unhandled* case.

The Sentry hook below is left commented; uncomment when §C.1 ships and
``sentry_sdk`` is initialised in ``api/main.py``.
"""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from api.middleware.request_id import get_request_id

logger = logging.getLogger(__name__)


def safe_error_detail(rid: str | None = None) -> dict[str, str]:
    """Body shape used by hand-rolled 5xx ``HTTPException(detail=...)`` raises.

    Mirrors the global handler's output so clients can key off the same
    ``error`` discriminator regardless of whether the failure was caught
    inline or by the safety net.
    """
    return {"error": "internal_error", "request_id": rid or "unknown"}


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """FastAPI handler for any ``Exception`` not caught by a route.

    Prefers ``request.state.request_id`` (set directly by RequestIDMiddleware)
    over ``get_request_id()`` because Starlette's ``BaseHTTPMiddleware`` runs
    the inner app in a child anyio task; by the time this handler executes,
    the ContextVar set in ``dispatch()`` is no longer in scope. ``request.state``
    is attached to the Request object and survives the task hop.
    """
    rid = getattr(request.state, "request_id", None) or get_request_id() or "unknown"
    logger.exception(
        "Unhandled exception [request_id=%s] path=%s", rid, request.url.path
    )
    # When Sentry lands (§C.1):
    # sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "request_id": rid},
    )
