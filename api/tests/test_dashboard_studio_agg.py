"""Integration tests for POST /dashboard/aggregate (studio interactive path).

Verifies the WIRING: the auth + access check, filter application, cache
behaviour, and the compact widget-data response shape. The aggregation engine
itself is parity-tested in test_dashboard_aggregate.py.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import dashboard as dash_router
from api.services.dashboard_aggregate import compute_custom

_POSTS = [
    {"post_id": "a", "platform": "twitter",  "sentiment": "positive",
     "view_count": 100, "like_count": 10, "comment_count": 2, "share_count": 1,
     "posted_at": "2026-01-01T00:00:00Z"},
    {"post_id": "b", "platform": "twitter",  "sentiment": "negative",
     "view_count": 50,  "like_count": 5,  "comment_count": 1, "share_count": 0,
     "posted_at": "2026-01-02T00:00:00Z"},
    {"post_id": "c", "platform": "youtube", "sentiment": "positive",
     "view_count": 200, "like_count": 20, "comment_count": 4, "share_count": 2,
     "posted_at": "2026-01-03T00:00:00Z"},
]

_LAYOUT = [
    {"i": "w-bar", "aggregation": "custom", "chartType": "bar",
     "customConfig": {"dimension": "platform", "metric": "post_count"}},
    {"i": "w-nc",  "aggregation": "custom", "chartType": "number-card",
     "customConfig": {"metric": "view_count"}},
    # Time-series line: server-aggregatable (day bucket)
    {"i": "w-line", "aggregation": "custom", "chartType": "line",
     "customConfig": {"dimension": "posted_at", "metric": "view_count", "timeBucket": "day"}},
    # Embed widget: not a chart (skipped by engine, no serverData)
    {"i": "w-embed", "aggregation": "embeds", "chartType": "embed"},
]

_OWNER_UID = "owner-uid"


def _owner_user() -> CurrentUser:
    return CurrentUser(
        uid=_OWNER_UID, email="owner@example.com",
        display_name="Owner", org_id=None, org_role=None,
    )


def _other_user() -> CurrentUser:
    return CurrentUser(
        uid="other-uid", email="other@example.com",
        display_name="Other", org_id=None, org_role=None,
    )


class _FakeFS:
    def __init__(self):
        self._statuses = {
            "coll-1": {"user_id": _OWNER_UID, "updated_at": "2026-01-04T00:00:00Z"},
        }

    def get_collection_status(self, cid):
        return self._statuses.get(cid)


@pytest.fixture
def client(monkeypatch):
    fs = _FakeFS()
    monkeypatch.setattr(dash_router, "get_fs", lambda: fs)
    monkeypatch.setattr(dash_router, "get_bq", lambda: object())
    monkeypatch.setattr(dash_router, "derive_agent_id_for_collections", lambda *_: "agent-1")

    async def _fake_core(_bq, _agent_id, _cids, _stamp):
        core = {
            "posts": [dict(p) for p in _POSTS],
            "topics": [],
            "kpis": {},
            "collection_names": {"coll-1": "Q"},
            "truncated": False,
        }
        return core, True, 0.0, 0.0

    monkeypatch.setattr(dash_router, "get_or_build_core", _fake_core)

    app = FastAPI()
    app.include_router(dash_router.router)
    app.dependency_overrides[get_current_user] = _owner_user
    yield TestClient(app)


@pytest.fixture
def other_client(monkeypatch):
    fs = _FakeFS()
    monkeypatch.setattr(dash_router, "get_fs", lambda: fs)
    monkeypatch.setattr(dash_router, "get_bq", lambda: object())

    async def _fake_core(_bq, _agent_id, _cids, _stamp):
        return {"posts": [], "topics": [], "kpis": {}, "collection_names": {}, "truncated": False}, True, 0.0, 0.0

    monkeypatch.setattr(dash_router, "get_or_build_core", _fake_core)

    app = FastAPI()
    app.include_router(dash_router.router)
    app.dependency_overrides[get_current_user] = _other_user
    yield TestClient(app)


def _post(client, filters=None, layout=None):
    body = {
        "collection_ids": ["coll-1"],
        "agent_id": "agent-1",
        "filters": filters or {},
        "layout": layout if layout is not None else _LAYOUT,
    }
    return client.post("/dashboard/aggregate", json=body)


# --- Auth / access ---

def test_returns_403_for_unowned_collection(other_client):
    res = _post(other_client)
    assert res.status_code == 403


def test_requires_collection_ids(client):
    res = client.post("/dashboard/aggregate", json={"collection_ids": [], "filters": {}, "layout": []})
    assert res.status_code == 400


# --- No-filter path (unfiltered = all posts) ---

def test_no_filter_aggregates_all_posts(client):
    res = _post(client, filters={})
    assert res.status_code == 200
    body = res.json()
    # bar + nc + line are covered; embed is skipped
    assert set(body["widgetData"]) == {"w-bar", "w-nc", "w-line"}
    assert body["tableData"] == {}
    assert body["feedData"] == {}

    wd = body["widgetData"]
    # Exact parity with the engine over all posts
    assert wd["w-bar"] == compute_custom(_POSTS, {"dimension": "platform", "metric": "post_count"})
    assert wd["w-nc"] == compute_custom(_POSTS, {"metric": "view_count"})
    # Sanity: bar shows 2 twitter + 1 youtube
    assert wd["w-bar"]["labels"] == ["twitter", "youtube"]
    assert wd["w-bar"]["values"] == [2, 1]
    assert wd["w-nc"]["value"] == 350  # 100+50+200


# --- Filter application ---

def test_platform_filter_narrows_posts(client):
    res = _post(client, filters={"platform": ["twitter"]})
    assert res.status_code == 200
    wd = res.json()["widgetData"]
    # Only twitter posts: view_count = 100+50 = 150
    assert wd["w-nc"]["value"] == 150
    # bar now has only twitter
    assert wd["w-bar"]["labels"] == ["twitter"]
    assert wd["w-bar"]["values"] == [2]


def test_sentiment_filter_narrows_posts(client):
    res = _post(client, filters={"sentiment": ["positive"]})
    assert res.status_code == 200
    wd = res.json()["widgetData"]
    # positive posts: a (100) + c (200) = 300 views
    assert wd["w-nc"]["value"] == 300


def test_date_range_filter(client):
    res = _post(client, filters={"date_range": {"from": "2026-01-02", "to": "2026-01-02"}})
    assert res.status_code == 200
    wd = res.json()["widgetData"]
    # only post b: 50 views
    assert wd["w-nc"]["value"] == 50


# --- Empty layout / empty filter result ---

def test_empty_layout_returns_empty_maps(client):
    res = _post(client, layout=[])
    assert res.status_code == 200
    body = res.json()
    assert body["widgetData"] == {}
    assert body["tableData"] == {}
    assert body["feedData"] == {}


def test_filter_that_matches_nothing(client):
    res = _post(client, filters={"platform": ["tiktok"]})
    assert res.status_code == 200
    wd = res.json()["widgetData"]
    # 0 posts → nc value = 0
    assert wd["w-nc"]["value"] == 0


# --- Caching ---

def test_same_filter_returns_identical_result_twice(client):
    # Two identical calls must return the same data (cache hit on second call).
    r1 = _post(client, filters={"platform": ["twitter"]})
    r2 = _post(client, filters={"platform": ["twitter"]})
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json()


def test_different_filters_produce_different_results(client):
    r1 = _post(client, filters={"platform": ["twitter"]})
    r2 = _post(client, filters={"platform": ["youtube"]})
    wd1 = r1.json()["widgetData"]
    wd2 = r2.json()["widgetData"]
    assert wd1["w-nc"]["value"] != wd2["w-nc"]["value"]
    assert wd1["w-nc"]["value"] == 150   # twitter
    assert wd2["w-nc"]["value"] == 200   # youtube
