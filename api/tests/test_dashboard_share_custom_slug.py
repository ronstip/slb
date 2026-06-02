"""Tests for the super-admin custom-slug shared-dashboard endpoint.

Covers the pure slug validator and the endpoint behavior (auth gating,
collision, replacing a previous custom slug, coexistence with the
random-token share).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import dashboard_shares as ds_router


# --- Pure slug validator ---


def test_validator_accepts_simple_slug():
    ds_router.validate_custom_slug("spotify-disco-ball")


def test_validator_accepts_min_length():
    ds_router.validate_custom_slug("abc")


def test_validator_accepts_alphanumeric():
    ds_router.validate_custom_slug("campaign2026")


@pytest.mark.parametrize(
    "bad",
    [
        "ab",                       # too short
        "a" * 65,                   # too long
        "-leading",                 # leading hyphen
        "trailing-",                # trailing hyphen
        "double--hyphen",           # double hyphen
        "UPPER",                    # uppercase
        "with space",               # space
        "weird_under",              # underscore
        "punct!",                   # punctuation
        "héllo",                    # non-ascii
        "",                         # empty
    ],
)
def test_validator_rejects_invalid(bad):
    with pytest.raises(Exception) as exc:
        ds_router.validate_custom_slug(bad)
    assert getattr(exc.value, "status_code", None) == 422


@pytest.mark.parametrize("reserved", ["public", "admin", "api", "new", "create"])
def test_validator_rejects_reserved(reserved):
    with pytest.raises(Exception) as exc:
        ds_router.validate_custom_slug(reserved)
    assert getattr(exc.value, "status_code", None) == 422


# --- Endpoint integration with fake FS + auth override ---


class FakeFS:
    """In-memory stand-in for FirestoreClient - just enough surface for the router."""

    def __init__(self):
        self.shares: dict[str, dict] = {}
        self.collections: dict[str, dict] = {}

    # collection / access helpers
    def get_collection_status(self, cid: str):
        return self.collections.get(cid)

    # dashboard share helpers
    def create_dashboard_share(self, token: str, data: dict) -> None:
        self.shares[token] = {**data}

    def get_dashboard_share(self, token: str):
        if token not in self.shares:
            return None
        data = dict(self.shares[token])
        data["token"] = token
        for key in ("created_at", "revoked_at", "last_accessed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def revoke_dashboard_share(self, token: str) -> None:
        self.shares[token]["revoked"] = True
        self.shares[token]["revoked_at"] = datetime.now(timezone.utc)

    def get_dashboard_share_by_dashboard(self, dashboard_id: str, owner_uid: str):
        for token, share in self.shares.items():
            if (
                share.get("dashboard_id") == dashboard_id
                and share.get("owner_uid") == owner_uid
                and not share.get("revoked")
                and not share.get("is_custom_slug")
            ):
                data = dict(share)
                data["token"] = token
                for key in ("created_at", "revoked_at", "last_accessed_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                return data
        return None

    def get_custom_share_by_dashboard(self, dashboard_id: str):
        for token, share in self.shares.items():
            if (
                share.get("dashboard_id") == dashboard_id
                and share.get("is_custom_slug")
                and not share.get("revoked")
            ):
                data = dict(share)
                data["token"] = token
                for key in ("created_at", "revoked_at", "last_accessed_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                return data
        return None


def _admin_user() -> CurrentUser:
    return CurrentUser(
        uid="admin-uid",
        email="admin@example.com",
        display_name="Admin",
        org_id=None,
        org_role=None,
    )


def _normal_user() -> CurrentUser:
    return CurrentUser(
        uid="user-uid",
        email="user@example.com",
        display_name="User",
        org_id=None,
        org_role=None,
    )


@pytest.fixture
def fake_fs(monkeypatch):
    fs = FakeFS()
    fs.collections["coll-1"] = {"user_id": "admin-uid", "org_id": None, "visibility": "private"}
    monkeypatch.setattr(ds_router, "get_fs", lambda: fs)
    return fs


@pytest.fixture
def admin_client(monkeypatch, fake_fs):
    monkeypatch.setattr(
        ds_router, "is_super_admin_email", lambda email: email == "admin@example.com"
    )
    app = FastAPI()
    app.include_router(ds_router.router)
    app.dependency_overrides[get_current_user] = _admin_user
    return TestClient(app)


@pytest.fixture
def user_client(monkeypatch, fake_fs):
    monkeypatch.setattr(
        ds_router, "is_super_admin_email", lambda email: email == "admin@example.com"
    )
    app = FastAPI()
    app.include_router(ds_router.router)
    app.dependency_overrides[get_current_user] = _normal_user
    fake_fs.collections["coll-1"]["user_id"] = "user-uid"
    return TestClient(app)


def _payload(slug: str) -> dict:
    return {
        "dashboard_id": "dash-1",
        "collection_ids": ["coll-1"],
        "title": "My Dashboard",
        "agent_id": "agent-1",
        "slug": slug,
    }


def test_non_admin_gets_403(user_client):
    res = user_client.post("/dashboard/shares/custom", json=_payload("nice-link"))
    assert res.status_code == 403


def test_admin_creates_custom_slug(admin_client, fake_fs):
    res = admin_client.post("/dashboard/shares/custom", json=_payload("spotify-disco-ball"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token"] == "spotify-disco-ball"
    assert body["share_url"].endswith("/shared/spotify-disco-ball")
    assert body["active"] is True
    assert fake_fs.shares["spotify-disco-ball"]["is_custom_slug"] is True


def test_invalid_slug_returns_422(admin_client):
    res = admin_client.post("/dashboard/shares/custom", json=_payload("BAD SLUG"))
    assert res.status_code == 422


def test_reserved_slug_returns_422(admin_client):
    res = admin_client.post("/dashboard/shares/custom", json=_payload("public"))
    assert res.status_code == 422


def test_collision_returns_409(admin_client, fake_fs):
    fake_fs.shares["taken-slug"] = {
        "owner_uid": "someone-else",
        "dashboard_id": "other-dash",
        "collection_ids": [],
        "agent_id": None,
        "title": "x",
        "created_at": datetime.now(timezone.utc),
        "revoked": False,
        "is_custom_slug": True,
    }
    res = admin_client.post("/dashboard/shares/custom", json=_payload("taken-slug"))
    assert res.status_code == 409


def test_creating_new_custom_slug_revokes_previous(admin_client, fake_fs):
    res1 = admin_client.post("/dashboard/shares/custom", json=_payload("first-slug"))
    assert res1.status_code == 200
    res2 = admin_client.post("/dashboard/shares/custom", json=_payload("second-slug"))
    assert res2.status_code == 200
    assert fake_fs.shares["first-slug"]["revoked"] is True
    assert fake_fs.shares["second-slug"]["revoked"] is False


def test_random_token_share_unaffected(admin_client, fake_fs):
    # Pre-existing random-token share for the same dashboard
    fake_fs.shares["RANDOM_TOKEN_XYZ"] = {
        "owner_uid": "admin-uid",
        "dashboard_id": "dash-1",
        "collection_ids": ["coll-1"],
        "agent_id": "agent-1",
        "title": "My Dashboard",
        "created_at": datetime.now(timezone.utc),
        "revoked": False,
        "is_custom_slug": False,
    }
    res = admin_client.post("/dashboard/shares/custom", json=_payload("vanity-link"))
    assert res.status_code == 200
    # Random token share must remain intact and not revoked.
    assert fake_fs.shares["RANDOM_TOKEN_XYZ"]["revoked"] is False


def test_get_custom_share_returns_existing(admin_client, fake_fs):
    admin_client.post("/dashboard/shares/custom", json=_payload("look-here"))
    res = admin_client.get("/dashboard/shares/custom/dash-1")
    assert res.status_code == 200
    body = res.json()
    assert body is not None
    assert body["token"] == "look-here"


def test_get_custom_share_returns_null_when_none(admin_client, fake_fs):
    res = admin_client.get("/dashboard/shares/custom/dash-1")
    assert res.status_code == 200
    assert res.json() is None
