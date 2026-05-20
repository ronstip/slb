"""Tests for the global exception handler + safe_error_detail.

Keeps these small and self-contained — building a tiny FastAPI app per test
avoids pulling Firestore/BQ deps from `api.main` into the test process.
"""

from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.errors import safe_error_detail, unhandled_exception_handler
from api.middleware.request_id import RequestIDMiddleware, get_request_id, set_request_id


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.get("/boom")
    async def boom() -> dict:
        raise RuntimeError("internal stack trace must not leak")

    return app


def test_safe_error_detail_with_rid() -> None:
    assert safe_error_detail("rid-123") == {"error": "internal_error", "request_id": "rid-123"}


def test_safe_error_detail_without_rid_falls_back_to_unknown() -> None:
    assert safe_error_detail(None) == {"error": "internal_error", "request_id": "unknown"}


def test_unhandled_exception_returns_safe_body_with_request_id() -> None:
    client = TestClient(_build_app(), raise_server_exceptions=False)
    res = client.get("/boom", headers={"X-Request-ID": "test-rid-abc"})
    assert res.status_code == 500
    body = res.json()
    assert body == {"error": "internal_error", "request_id": "test-rid-abc"}
    # Trace must NOT leak.
    assert "internal stack trace must not leak" not in res.text
    assert "RuntimeError" not in res.text


def test_unhandled_exception_uses_unknown_when_request_id_missing() -> None:
    # No X-Request-ID header — middleware generates one. The handler must
    # still emit it (not "unknown"), so the FE has a correlation id.
    client = TestClient(_build_app(), raise_server_exceptions=False)
    res = client.get("/boom")
    body = res.json()
    assert body["error"] == "internal_error"
    assert body["request_id"]
    assert body["request_id"] != "unknown"


def test_handler_can_read_request_id_in_isolation() -> None:
    """Sanity check that get_request_id() works inside an asyncio context —
    the handler reads it before composing the response."""

    async def _go() -> str | None:
        set_request_id("scope-id")
        return get_request_id()

    assert asyncio.run(_go()) == "scope-id"
