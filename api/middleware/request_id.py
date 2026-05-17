"""Request-ID middleware + ContextVar.

Every inbound HTTP request gets a stable identifier so logs and downstream
cost/usage rows can be paired with the originating request. If the caller
already supplied ``X-Request-ID`` (e.g. propagated through Cloud Tasks from
the API to the worker), it is honored verbatim; otherwise a fresh UUID is
generated. The id is exposed back to clients on the response header.

The current request id is stored in a ``ContextVar`` so synchronous helpers
deep in the call stack can read it without plumbing it as an argument. Use
:func:`get_request_id` from anywhere; it returns ``None`` outside an HTTP
request scope (e.g. CLI worker invocations).
"""

from __future__ import annotations

import re
from contextvars import ContextVar
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

HEADER_NAME = "X-Request-ID"

_current_request_id: ContextVar[str | None] = ContextVar(
    "current_request_id", default=None,
)

# Accept only safe ASCII ids from inbound headers; reject anything else and
# generate fresh. Guards against log-injection / header smuggling.
_VALID_ID = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")


def get_request_id() -> str | None:
    """Return the current request id, or ``None`` outside a request scope."""
    return _current_request_id.get()


def set_request_id(value: str | None) -> None:
    """Set the current request id explicitly.

    Useful for non-HTTP entry points (worker CLI scripts, scheduled jobs)
    that want to attach a stable id to their cost rows.
    """
    _current_request_id.set(value)


def new_request_id() -> str:
    """Generate a fresh request id."""
    return uuid4().hex


def outbound_headers(base: dict[str, str] | None = None) -> dict[str, str]:
    """Return a headers dict with ``X-Request-ID`` propagated from the current
    context, if any. Use when dispatching Cloud Tasks (or any HTTP call) so the
    downstream worker can pair its cost / log rows with the originating
    user-facing request.
    """
    headers = dict(base) if base else {}
    rid = get_request_id()
    if rid:
        headers[HEADER_NAME] = rid
    return headers


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Read or generate ``X-Request-ID`` and bind it for the request lifetime."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(HEADER_NAME)
        request_id = incoming if incoming and _VALID_ID.match(incoming) else new_request_id()

        token = _current_request_id.set(request_id)
        # Stash on request.state for handlers that prefer attribute access.
        request.state.request_id = request_id
        try:
            response: Response = await call_next(request)
        finally:
            _current_request_id.reset(token)

        response.headers[HEADER_NAME] = request_id
        return response
