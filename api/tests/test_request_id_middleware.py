"""Unit tests for the request-id middleware + propagation helper."""

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.request_id import (
    HEADER_NAME,
    RequestIDMiddleware,
    get_request_id,
    new_request_id,
    outbound_headers,
)


@pytest.fixture()
def app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/echo")
    def echo():
        return {"rid": get_request_id()}

    return app


def test_generates_id_when_header_absent(app: FastAPI):
    client = TestClient(app)
    r = client.get("/echo")
    assert r.status_code == 200
    rid = r.headers.get(HEADER_NAME)
    assert rid and len(rid) >= 16
    assert r.json()["rid"] == rid


def test_honors_incoming_header(app: FastAPI):
    client = TestClient(app)
    r = client.get("/echo", headers={HEADER_NAME: "abc-123_DEF"})
    assert r.headers[HEADER_NAME] == "abc-123_DEF"
    assert r.json()["rid"] == "abc-123_DEF"


def test_rejects_invalid_incoming_header_and_regenerates(app: FastAPI):
    client = TestClient(app)
    # Contains characters outside the allowed set - should be discarded.
    r = client.get("/echo", headers={HEADER_NAME: "bad id with spaces & symbols"})
    rid = r.headers[HEADER_NAME]
    assert rid != "bad id with spaces & symbols"
    assert rid == r.json()["rid"]


def test_context_var_clears_between_requests(app: FastAPI):
    client = TestClient(app)
    r1 = client.get("/echo", headers={HEADER_NAME: "req-one"})
    r2 = client.get("/echo", headers={HEADER_NAME: "req-two"})
    assert r1.json()["rid"] == "req-one"
    assert r2.json()["rid"] == "req-two"


def test_get_request_id_returns_none_outside_request_scope():
    assert get_request_id() is None


def test_outbound_headers_omits_request_id_when_absent():
    # No request scope active - outbound_headers should not add the header.
    headers = outbound_headers({"Content-Type": "application/json"})
    assert HEADER_NAME not in headers
    assert headers["Content-Type"] == "application/json"


def test_outbound_headers_propagates_request_id_when_present(app: FastAPI):
    captured: dict = {}

    @app.get("/dispatch")
    def dispatch():
        captured.update(outbound_headers({"Content-Type": "application/json"}))
        return {"ok": True}

    client = TestClient(app)
    client.get("/dispatch", headers={HEADER_NAME: "trace-xyz"})
    assert captured.get(HEADER_NAME) == "trace-xyz"
    assert captured["Content-Type"] == "application/json"


def test_new_request_id_is_unique():
    assert new_request_id() != new_request_id()
