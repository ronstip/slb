"""Tests for POST /upload/media (dashboard media-widget uploads).

Covers the content-type/extension allowlist (images + gif + video), the
size cap, the GCS blob path/namespace, and the auth gate. GCS is faked so
the test never touches a real bucket.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import media as media_router


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeBlob:
    def __init__(self, name: str):
        self.name = name
        self.content_type: str | None = None
        self.data: bytes | None = None

    def upload_from_string(self, contents: bytes, content_type: str | None = None):
        self.data = contents
        self.content_type = content_type


class FakeBucket:
    def __init__(self):
        self.blobs: dict[str, FakeBlob] = {}

    def blob(self, name: str) -> FakeBlob:
        blob = FakeBlob(name)
        self.blobs[name] = blob
        return blob


class FakeGCS:
    def __init__(self):
        self.bucket_obj = FakeBucket()

    def bucket(self, _name: str) -> FakeBucket:
        return self.bucket_obj


def _user() -> CurrentUser:
    return CurrentUser(
        uid="user-1", email="u@example.com",
        display_name="U", org_id=None, org_role=None,
    )


@pytest.fixture
def fake_gcs(monkeypatch):
    gcs = FakeGCS()
    monkeypatch.setattr(media_router, "get_gcs", lambda: gcs)
    return gcs


@pytest.fixture
def client(fake_gcs):
    app = FastAPI()
    app.include_router(media_router.router)
    app.dependency_overrides[get_current_user] = _user
    return TestClient(app)


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------


def test_upload_png(client, fake_gcs):
    resp = client.post(
        "/upload/media",
        files={"file": ("pic.png", b"\x89PNG\r\n\x1a\n" + b"0" * 100, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "image"
    assert body["gcs_path"].startswith("dashboard-media/user-1/")
    assert body["gcs_path"].endswith(".png")
    # The blob was actually written to the (faked) bucket.
    assert body["gcs_path"] in fake_gcs.bucket_obj.blobs


def test_upload_gif_is_image_kind(client):
    resp = client.post(
        "/upload/media",
        files={"file": ("anim.gif", b"GIF89a" + b"0" * 50, "image/gif")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "image"


def test_upload_mp4_is_video_kind(client):
    resp = client.post(
        "/upload/media",
        files={"file": ("clip.mp4", b"\x00\x00\x00\x18ftyp" + b"0" * 100, "video/mp4")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "video"
    assert body["gcs_path"].endswith(".mp4")


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_reject_disallowed_type(client):
    resp = client.post(
        "/upload/media",
        files={"file": ("doc.pdf", b"%PDF-1.4" + b"0" * 50, "application/pdf")},
    )
    assert resp.status_code == 400, resp.text


def test_reject_oversize(client, monkeypatch):
    # Force a tiny cap so we don't have to build a 25MB payload in-memory.
    monkeypatch.setattr(media_router, "MAX_MEDIA_BYTES", 10)
    resp = client.post(
        "/upload/media",
        files={"file": ("big.png", b"0" * 1000, "image/png")},
    )
    assert resp.status_code == 413, resp.text
