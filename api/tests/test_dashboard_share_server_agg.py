"""Integration test for P2 server-side aggregation on the public share endpoint.

Verifies the WIRING (the engine itself is parity-tested in
test_dashboard_aggregate.py): the `?agg=server` flag toggles a `widgetData` map
of pre-aggregated series, keyed by widget id, for the server-aggregatable
widgets only — and an unflagged request is byte-for-byte the pre-P2 body
(no `widgetData` key). Collaborators that touch BigQuery/Firestore are faked.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.rate_limiting import limiter
from api.routers import dashboard_shares as ds_router
from api.services.dashboard_aggregate import compute_custom

_POSTS = [
    {"post_id": "a", "platform": "twitter", "view_count": 100, "like_count": 10,
     "comment_count": 2, "share_count": 1, "posted_at": "2026-01-01T00:00:00Z", "post_url": "https://x/a"},
    {"post_id": "b", "platform": "twitter", "view_count": 50, "like_count": 5,
     "comment_count": 1, "share_count": 0, "posted_at": "2026-01-02T00:00:00Z", "post_url": "https://x/b"},
    {"post_id": "c", "platform": "youtube", "view_count": 200, "like_count": 20,
     "comment_count": 4, "share_count": 2, "posted_at": "2026-01-03T00:00:00Z", "post_url": "https://x/c"},
]

# Two server-aggregatable widgets + two the engine must skip (time series, embed).
_LAYOUT = [
    {"i": "w-bar", "aggregation": "custom", "chartType": "bar",
     "customConfig": {"dimension": "platform", "metric": "post_count"}},
    {"i": "w-nc", "aggregation": "custom", "chartType": "number-card",
     "customConfig": {"metric": "view_count"}},
    {"i": "w-line", "aggregation": "custom", "chartType": "line",
     "customConfig": {"dimension": "posted_at", "metric": "view_count"}},
    {"i": "w-embed", "aggregation": "embeds", "chartType": "embed"},
]


class _FakeDoc:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return self._data


class _FakeRef:
    def __init__(self, data):
        self._data = data

    def get(self):
        return _FakeDoc(self._data)

    def update(self, *_a, **_k):
        return None


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def document(self, doc_id):
        return _FakeRef(self._docs.get(doc_id))


class _FakeDb:
    def __init__(self):
        self.data: dict[str, dict] = {}

    def collection(self, name):
        return _FakeCollection(self.data.get(name, {}))


class _FakeFS:
    def __init__(self):
        self._db = _FakeDb()
        self.share = {
            "token": "tok1", "dashboard_id": "dash-1", "agent_id": "agent-1",
            "collection_ids": ["coll-1"], "title": "Shared", "revoked": False,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        self._db.data["dashboard_layouts"] = {
            "dash-1": {"layout": _LAYOUT, "filterBarHidden": True, "reportConfig": None}
        }

    def get_dashboard_share(self, token):
        return dict(self.share) if token == self.share["token"] else None

    def get_agent_collection_ids(self, _agent_id):
        return self.share["collection_ids"]

    def get_collection_statuses(self, cids):
        return {c: {"updated_at": "2026-01-01T00:00:00Z"} for c in cids}


@pytest.fixture
def client(monkeypatch):
    fs = _FakeFS()
    monkeypatch.setattr(ds_router, "get_fs", lambda: fs)
    monkeypatch.setattr(ds_router, "get_bq", lambda: object())

    async def _fake_core(_bq, _agent_id, _cids, _stamp):
        core = {
            "posts": [dict(p) for p in _POSTS],
            "topics": [],
            "kpis": {},
            "collection_names": {"coll-1": "Q"},
            "truncated": False,
        }
        return core, True, 0.0, 0.0

    monkeypatch.setattr(ds_router, "get_or_build_core", _fake_core)

    app = FastAPI()
    app.state.limiter = limiter
    was_enabled = limiter.enabled
    limiter.enabled = False  # avoid 30/min accounting across requests
    app.include_router(ds_router.router)
    yield TestClient(app)
    limiter.enabled = was_enabled


def test_agg_client_forces_legacy_full_posts_path(client):
    # `?agg=client` is the debug escape hatch: byte-identical to the pre-P2 body
    # (no widgetData, full posts) even though server-agg is now default-on.
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=client")
    assert res.status_code == 200
    body = res.json()
    assert "widgetData" not in body
    assert len(body["posts"]) == 3
    assert body["filterBarHidden"] is True


def test_default_on_aggregates_without_query_param(client):
    # #6 default-on: no `agg` param now enables server aggregation (gated by the
    # DASHBOARD_SERVER_AGG setting, which defaults true).
    res = client.get("/dashboard/shares/public/tok1?slim=1")
    assert res.status_code == 200
    body = res.json()
    assert set(body["widgetData"]) == {"w-bar", "w-nc", "w-line"}


def test_kill_switch_setting_disables_server_agg(client, monkeypatch):
    # #6 kill switch: DASHBOARD_SERVER_AGG=false forces the legacy path even when
    # the client explicitly requests agg=server.
    from config.settings import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "dashboard_server_agg", False)
    monkeypatch.setattr(ds_router, "get_settings", lambda: s)
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    assert res.status_code == 200
    body = res.json()
    assert "widgetData" not in body
    assert len(body["posts"]) == 3


def test_flagged_response_aggregates_eligible_widgets(client):
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    assert res.status_code == 200
    body = res.json()
    wd = body["widgetData"]

    # The bar, number-card, and (day) time-series widgets are covered; the embed
    # widget is skipped → keeps client-side aggregation.
    assert set(wd) == {"w-bar", "w-nc", "w-line"}

    # Served series equal the engine run over the same posts.
    assert wd["w-bar"] == compute_custom(_POSTS, {"dimension": "platform", "metric": "post_count"})
    assert wd["w-nc"] == compute_custom(_POSTS, {"metric": "view_count"})

    # Sanity on the actual numbers (independent of the engine):
    assert wd["w-bar"] == {"value": 3, "labels": ["twitter", "youtube"], "values": [2, 1]}
    assert wd["w-nc"]["value"] == 350  # 100 + 50 + 200
    assert [pt["date"] for pt in wd["w-line"]["timeSeries"]] == ["2026-01-01", "2026-01-02", "2026-01-03"]

    # The layout itself is returned untouched (FE merges serverData client-side).
    assert all("serverData" not in w for w in body["layout"])


def test_fully_covered_drops_posts_to_feed_union(client):
    # Layout: a covered chart + a COLLECTION embed (bounded feed) → fully covered
    # → posts collapse to just the embed's ranked union.
    fs = ds_router.get_fs()
    fs._db.data["dashboard_layouts"]["dash-1"]["layout"] = [
        {"i": "chart", "aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "platform", "metric": "post_count"}},
        {"i": "feed", "aggregation": "embeds", "chartType": "embed",
         "embedConfig": {"source": "collection", "rankBy": "view_count", "count": 2}},
        {"i": "note", "aggregation": "text", "chartType": "table", "markdownContent": "hi"},
    ]
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    body = res.json()
    assert body["serverComplete"] is True
    # Only the top-2-by-views posts (c=200, a=100) ship — not b (50).
    assert {p["post_id"] for p in body["posts"]} == {"c", "a"}
    assert body["feedData"]["feed"] == ["c", "a"]  # ranked display order
    assert set(body["widgetData"]) == {"chart"}


def test_partial_coverage_keeps_full_posts(client):
    fs = ds_router.get_fs()
    fs._db.data["dashboard_layouts"]["dash-1"]["layout"] = [
        {"i": "chart", "aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "platform", "metric": "post_count"}},
        # KPI widget needs posts and isn't covered → blocks the omit gate.
        {"i": "kpi", "aggregation": "kpi", "chartType": "number-card"},
    ]
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    body = res.json()
    assert body["serverComplete"] is False
    assert len(body["posts"]) == 3  # full set retained for the uncovered KPI


def test_report_scope_narrows_aggregation_input(client):
    # #2: a committed reportScope (platform=twitter) pre-narrows the set; the bar
    # widget must aggregate only a+b (twitter), NOT youtube post c.
    fs = ds_router.get_fs()
    fs._db.data["dashboard_layouts"]["dash-1"]["reportScope"] = {"platform": ["twitter"]}
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    body = res.json()
    assert body["widgetData"]["w-bar"] == {"value": 2, "labels": ["twitter"], "values": [2]}
    # w-nc (sum view_count) over the scoped set = 100 + 50 = 150 (not 350).
    assert body["widgetData"]["w-nc"]["value"] == 150


def test_heatmap_widget_is_covered(client):
    # #3: a categorical heatmap (platform × — single row) is server-covered.
    fs = ds_router.get_fs()
    fs._db.data["dashboard_layouts"]["dash-1"]["layout"] = [
        {"i": "heat", "aggregation": "custom", "chartType": "heatmap",
         "customConfig": {"dimension": "platform", "breakdownDimension": "platform",
                          "metric": "post_count"}},
    ]
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    body = res.json()
    assert "heat" in body["widgetData"]
    assert body["widgetData"]["heat"]["groupedCategorical"]["labels"] == ["twitter", "youtube"]


def test_post_mode_table_ships_as_feed(client):
    # #5: a post-mode table sorted by a numeric column ships a bounded post-id
    # feed and (with only static siblings) trips the omit gate.
    fs = ds_router.get_fs()
    fs._db.data["dashboard_layouts"]["dash-1"]["layout"] = [
        {"i": "ptbl", "aggregation": "custom", "chartType": "table",
         "tableConfig": {"mode": "post",
                         "columns": [{"id": "v", "kind": "post-field", "postField": "view_count"}],
                         "sortBy": "v", "sortDir": "desc", "rowLimit": 2}},
    ]
    res = client.get("/dashboard/shares/public/tok1?slim=1&agg=server")
    body = res.json()
    # Top-2 by view_count: c(200), a(100).
    assert body["feedData"]["ptbl"] == ["c", "a"]
    assert body["serverComplete"] is True
    assert {p["post_id"] for p in body["posts"]} == {"c", "a"}
