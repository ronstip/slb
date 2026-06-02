"""Tests for POST /agents/{agent_id}/fetch-posts.

Covers the URL-parse + grouping logic at the service layer, the endpoint
auth gate, and the error shape for unparseable / unsupported URLs.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import agents as agents_router


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeFS:
    def __init__(self):
        self.agents: dict[str, dict] = {}
        self.agent_collections: dict[str, list[str]] = {}
        self.collection_status_updates: list[tuple] = []

    def add_agent_collection(self, agent_id: str, cid: str) -> None:
        self.agent_collections.setdefault(agent_id, []).append(cid)

    def update_collection_status(self, cid: str, **kwargs) -> None:
        self.collection_status_updates.append((cid, kwargs))

    def update_agent(self, agent_id: str, **kwargs) -> None:
        self.agents.setdefault(agent_id, {}).update(kwargs)

    def add_agent_log(self, agent_id, message, source="system", level="info", metadata=None):
        pass


def _owner_user() -> CurrentUser:
    return CurrentUser(
        uid="owner-uid", email="owner@example.com",
        display_name="Owner", org_id=None, org_role=None,
    )


def _other_user() -> CurrentUser:
    return CurrentUser(
        uid="other-uid", email="other@example.com",
        display_name="Other", org_id=None, org_role=None,
    )


@pytest.fixture
def fake_fs(monkeypatch):
    fs = FakeFS()
    fs.agents["agent-1"] = {
        "agent_id": "agent-1",
        "user_id": "owner-uid",
        "org_id": None,
        "title": "Test Agent",
        "version": 1,
    }

    from api.services import agent_service

    monkeypatch.setattr(agent_service, "get_fs", lambda: fs)

    def fake_get_agent(agent_id):
        return fs.agents.get(agent_id)

    monkeypatch.setattr(agent_service, "get_agent", fake_get_agent)
    return fs


@pytest.fixture
def created_collections(monkeypatch):
    """Capture each create_collection_from_request call."""
    calls: list[dict] = []

    def fake_create(request, user_id, org_id=None, session_id="", extra_config=None):
        cid = f"col-{len(calls) + 1}"
        calls.append({
            "request": request,
            "user_id": user_id,
            "org_id": org_id,
            "extra_config": extra_config or {},
            "collection_id": cid,
        })
        return {"collection_id": cid, "status": "pending", "config": {}}

    from api.services import agent_service

    monkeypatch.setattr(agent_service, "create_collection_from_request", fake_create, raising=False)
    # The service does a function-level `from api.services.collection_service import create_collection_from_request`
    # so patch the source too:
    from api.services import collection_service

    monkeypatch.setattr(
        collection_service, "create_collection_from_request", fake_create,
    )
    return calls


@pytest.fixture
def owner_client(fake_fs, created_collections):
    app = FastAPI()
    app.include_router(agents_router.router)
    app.dependency_overrides[get_current_user] = _owner_user
    return TestClient(app)


@pytest.fixture
def other_client(fake_fs, created_collections):
    app = FastAPI()
    app.include_router(agents_router.router)
    app.dependency_overrides[get_current_user] = _other_user
    return TestClient(app)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_owner_can_fetch_posts_by_url(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={
            "urls": [
                "https://x.com/alice/status/12345",
                "https://twitter.com/bob/status/67890",
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["agent_id"] == "agent-1"
    assert body["status"] == "running"
    # One collection per platform - both URLs are twitter → one collection.
    assert len(body["collection_ids"]) == 1

    # Verify the request that was dispatched.
    assert len(created_collections) == 1
    req = created_collections[0]["request"]
    assert req.platforms == ["twitter"]
    assert req.post_urls == [
        "https://x.com/alice/status/12345",
        "https://twitter.com/bob/status/67890",
    ]
    assert req.n_posts == 2
    # Default off - see plan §G3.
    assert req.include_comments is False


def test_include_comments_flag_propagates(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={
            "urls": ["https://x.com/alice/status/12345"],
            "include_comments": True,
            "note": "Investor day reactions",
        },
    )
    assert resp.status_code == 200, resp.text
    req = created_collections[0]["request"]
    assert req.include_comments is True
    assert "Investor day reactions" in req.description


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_unparseable_url_returns_400(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": ["https://x.com/alice/status/123", "garbage-url"]},
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "garbage-url" in detail.get("bad_urls", [])
    # No collection should have been created on a parse failure.
    assert created_collections == []


def test_unsupported_platform_returns_400(owner_client, created_collections):
    # YouTube isn't wired (no parser + no adapter branch). IG IS wired now -
    # if you flip this to an IG URL, swap to test_owner_can_fetch_instagram_post_by_url.
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": ["https://www.youtube.com/watch?v=abc123"]},
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    # Either captured as bad_urls (parser doesn't know YouTube yet) OR as
    # unsupported_platforms (parser knows but adapter doesn't). Both shapes ok
    # - what matters is no collection was dispatched.
    assert detail.get("bad_urls") or detail.get("unsupported_platforms")
    assert created_collections == []


def test_owner_can_fetch_instagram_post_by_url(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": ["https://www.instagram.com/p/Cabc123/"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["collection_ids"]) == 1
    req = created_collections[0]["request"]
    assert req.platforms == ["instagram"]
    assert req.post_urls == ["https://www.instagram.com/p/Cabc123/"]


def test_instagram_reel_canonicalised_to_singular_reel(owner_client, created_collections):
    """/reels/ → /reel/ canonicalisation kicks in server-side so Apify directUrls
    accepts the URL even when the user pasted the plural form."""
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": ["https://www.instagram.com/reels/foo_BAR/"]},
    )
    assert resp.status_code == 200, resp.text
    req = created_collections[0]["request"]
    assert req.post_urls == ["https://www.instagram.com/reel/foo_BAR/"]


def test_duplicate_urls_are_deduped_before_dispatch(owner_client, created_collections):
    """Apify's instagram-scraper rejects directUrls with duplicates outright,
    so we dedupe by canonical URL before dispatch. Also covers URL variants
    that canonicalise to the same form (e.g. /reels/ + /reel/)."""
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={
            "urls": [
                "https://www.instagram.com/p/Cabc/",
                "https://www.instagram.com/p/Cabc/",        # exact dup
                "https://www.instagram.com/reels/Xyz/",     # canonicalises to /reel/Xyz/
                "https://www.instagram.com/reel/Xyz/",      # same canonical as above
                "https://www.instagram.com/p/Cdef/",        # distinct
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    req = created_collections[0]["request"]
    assert req.post_urls == [
        "https://www.instagram.com/p/Cabc/",
        "https://www.instagram.com/reel/Xyz/",
        "https://www.instagram.com/p/Cdef/",
    ]
    assert req.n_posts == 3


def test_mixed_x_and_ig_urls_creates_two_collections(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={
            "urls": [
                "https://x.com/alice/status/12345",
                "https://www.instagram.com/p/Cabc/",
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["collection_ids"]) == 2
    platforms_dispatched = {
        c["request"].platforms[0] for c in created_collections
    }
    assert platforms_dispatched == {"twitter", "instagram"}


def test_empty_urls_returns_400(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": []},
    )
    assert resp.status_code == 400, resp.text
    assert created_collections == []


def test_non_owner_gets_403(other_client, created_collections):
    resp = other_client.post(
        "/agents/agent-1/fetch-posts",
        json={"urls": ["https://x.com/alice/status/12345"]},
    )
    assert resp.status_code == 403, resp.text
    assert created_collections == []


def test_unknown_agent_returns_404(owner_client, created_collections):
    resp = owner_client.post(
        "/agents/no-such-agent/fetch-posts",
        json={"urls": ["https://x.com/alice/status/12345"]},
    )
    assert resp.status_code == 404, resp.text
    assert created_collections == []
