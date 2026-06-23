"""Phase 1 — webhook transport (plan phase 1): GET verification handshake,
POST signature gate + enqueue. No worker processing inline."""

import hashlib
import hmac
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

import api.routers.whatsapp as wa

SECRET = "app-secret"
VERIFY = "verify-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(
        wa,
        "get_settings",
        lambda: SimpleNamespace(
            whatsapp_app_secret=SECRET, whatsapp_verify_token=VERIFY
        ),
    )
    dispatched: list = []
    monkeypatch.setattr(
        wa, "dispatch_worker_task", lambda path, payload: dispatched.append((path, payload))
    )
    app = FastAPI()
    app.include_router(wa.router)
    c = TestClient(app)
    c.dispatched = dispatched  # type: ignore[attr-defined]
    return c


def _sig(body: bytes) -> str:
    return "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def test_verify_handshake_echoes_challenge(client):
    resp = client.get(
        "/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY,
            "hub.challenge": "CHALLENGE123",
        },
    )
    assert resp.status_code == 200
    assert resp.text == "CHALLENGE123"


def test_verify_handshake_rejects_bad_token(client):
    resp = client.get(
        "/whatsapp/webhook",
        params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "x"},
    )
    assert resp.status_code == 403


def test_post_good_signature_acks_and_enqueues(client):
    payload = {"object": "whatsapp_business_account", "entry": []}
    body = json.dumps(payload).encode()
    resp = client.post(
        "/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": _sig(body), "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert len(client.dispatched) == 1
    path, task_payload = client.dispatched[0]
    assert path == "/whatsapp/inbound"
    assert task_payload == {"payload": payload}


def test_post_bad_signature_rejected_and_not_enqueued(client):
    body = b'{"object":"whatsapp_business_account"}'
    resp = client.post(
        "/whatsapp/webhook",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=deadbeef", "Content-Type": "application/json"},
    )
    assert resp.status_code == 403
    assert client.dispatched == []
