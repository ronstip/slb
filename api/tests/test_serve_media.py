"""Tests for GET /media/{path} (GCS media proxy).

Focus on the two things iOS Safari needs from a `<video>` source and that
desktop Chrome is lenient about:

1. A correct `video/mp4` Content-Type (derived from the file extension - the
   GCS objects are frequently stored as `application/octet-stream`).
2. HTTP Range support: a `Range` request must return `206 Partial Content`
   with a `Content-Range` header and only the requested bytes. Answering a
   Range request with a full-body `200` makes iOS refuse to play the clip.

GCS is faked so the test never touches a real bucket.
"""

from __future__ import annotations

import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import media as media_router


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeBlob:
    def __init__(self, data: bytes, content_type: str | None):
        self._data = data
        self.content_type = content_type
        self.size: int | None = None

    def exists(self) -> bool:
        return self._data is not None

    def reload(self) -> None:
        self.size = len(self._data)

    def open(self, _mode: str = "rb") -> io.BytesIO:
        # io.BytesIO is a context manager and supports seek/read, matching the
        # slice of google-cloud-storage BlobReader the handler relies on.
        return io.BytesIO(self._data)


class FakeBucket:
    def __init__(self, blob: FakeBlob):
        self._blob = blob

    def blob(self, _name: str) -> FakeBlob:
        return self._blob


class FakeGCS:
    def __init__(self, blob: FakeBlob):
        self._bucket = FakeBucket(blob)

    def bucket(self, _name: str) -> FakeBucket:
        return self._bucket


@pytest.fixture
def make_client(monkeypatch):
    def _make(data: bytes, content_type: str | None = "application/octet-stream"):
        gcs = FakeGCS(FakeBlob(data, content_type))
        monkeypatch.setattr(media_router, "get_gcs", lambda: gcs)
        app = FastAPI()
        app.include_router(media_router.router)
        return TestClient(app)

    return _make


# ---------------------------------------------------------------------------
# Content-Type
# ---------------------------------------------------------------------------


def test_mp4_served_as_video_mimetype(make_client):
    """An mp4 stored as octet-stream must still be served as video/mp4 so iOS
    Safari selects the right decoder."""
    client = make_client(b"\x00\x00\x00\x18ftyp" + b"0" * 500, "application/octet-stream")
    resp = client.get("/media/abc/clip_0.mp4")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("video/mp4")


# ---------------------------------------------------------------------------
# Range support
# ---------------------------------------------------------------------------


def test_full_get_advertises_ranges(make_client):
    client = make_client(b"A" * 500)
    resp = client.get("/media/abc/clip_0.mp4")
    assert resp.status_code == 200
    assert resp.headers.get("accept-ranges") == "bytes"


def test_range_returns_206_partial(make_client):
    body = bytes(range(256)) * 2  # 512 bytes, distinct values
    client = make_client(body)
    resp = client.get("/media/abc/clip_0.mp4", headers={"Range": "bytes=0-99"})
    assert resp.status_code == 206, resp.text
    assert resp.headers["content-range"] == f"bytes 0-99/{len(body)}"
    assert resp.headers["content-length"] == "100"
    assert resp.content == body[0:100]


def test_open_ended_range(make_client):
    body = b"".join(bytes([i % 256]) for i in range(500))
    client = make_client(body)
    resp = client.get("/media/abc/clip_0.mp4", headers={"Range": "bytes=100-"})
    assert resp.status_code == 206, resp.text
    assert resp.headers["content-range"] == f"bytes 100-499/{len(body)}"
    assert resp.content == body[100:]


def test_unsatisfiable_range_416(make_client):
    client = make_client(b"A" * 100)
    resp = client.get("/media/abc/clip_0.mp4", headers={"Range": "bytes=500-600"})
    assert resp.status_code == 416, resp.text
