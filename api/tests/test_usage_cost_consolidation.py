"""Pins the cost-writer consolidation invariant (Phase 2 of the cost-meter
accuracy fix):

  * `usage_service.track_posts_collected` is the VOLUME path - it writes a
    `posts_collected` analytics row that is **cost-free** (cost_micros NULL),
    even when provider + units are known. It must not price anything.
  * `cost_meter.log_cost` is the single COST path - a units-priced scraper
    (BrightData / X API) produces ONE `provider_call` row with non-NULL
    rate-table cost.

Together these guarantee scrape cost flows through exactly one meter, so the
admin aggregates (which SUM cost_micros across all event_types) never
double-count and never silently drop a provider.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from api.services import cost_meter, usage_service


class _FakeBQ:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def insert_rows(self, table: str, rows: list[dict]) -> int:
        assert table == "usage_events"
        self.rows.extend(rows)
        return 0


class _FakeFS:
    def __init__(self) -> None:
        self.counters: list[tuple[str, str, int]] = []

    def increment_usage(self, user_id, org_id, field, n) -> None:
        self.counters.append((user_id, field, n))

    def apply_spend_micros(self, uid: str, micros: int) -> None:  # cost_meter wallet
        pass


@pytest.fixture(autouse=True)
def _pin_margin(monkeypatch):
    monkeypatch.setattr("config.cost_rates.get_margin_multiplier", lambda: 1.0)


@pytest.fixture()
def fakes(monkeypatch):
    bq, fs = _FakeBQ(), _FakeFS()
    monkeypatch.setattr("api.deps.get_bq", lambda: bq)
    monkeypatch.setattr("api.deps.get_fs", lambda: fs)
    return bq, fs


def _wait(bq: _FakeBQ, n: int = 1, timeout: float = 2.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(bq.rows) >= n:
            return
        time.sleep(0.01)
    raise AssertionError(f"never inserted {n} rows (got {len(bq.rows)})")


def test_track_posts_collected_is_cost_free(fakes):
    """The volume path must NOT price - even with provider + units known,
    the `posts_collected` row carries NULL cost (cost lives on the matching
    provider_call row)."""
    bq, _ = fakes
    usage_service.track_posts_collected(
        "u1", "org1", "col1", count=10, provider="brightdata",
        agent_id="a1", platform="youtube",
    )
    _wait(bq)
    row = bq.rows[0]
    assert row["event_type"] == "posts_collected"
    assert row["provider"] == "brightdata"   # still labelled for analytics
    assert row["units"] == 10
    assert row["platform"] == "youtube"
    assert row["cost_micros"] is None        # the invariant: cost-free
    assert row["cost_source"] is None


def test_scrape_cost_flows_through_cost_meter(fakes):
    """A units-priced scraper produces ONE provider_call row with non-NULL
    rate-table cost via cost_meter - the single cost source."""
    bq, _ = fakes
    # BrightData seed rate = $0.0025/record → 10 records = 25_000 micros.
    cost_meter.log_cost(
        provider="brightdata",
        user_id="u1",
        feature="scrape",
        event_type=cost_meter.EVENT_PROVIDER,
        units=10,
        unit_kind="posts",
        platform="youtube",
    )
    _wait(bq)
    row = bq.rows[0]
    assert row["event_type"] == "provider_call"
    assert row["provider"] == "brightdata"
    assert row["cost_micros"] == 25_000
    assert row["cost_source"] == "rate_table"


def test_runner_rebinds_cost_context_with_resolved_agent_id():
    """The pipeline runner must rebind the cost-meter collection context with
    the agent_id it resolves from Firestore.

    The dev dispatch thread binds agent_id=None (it isn't in extra_config), so
    without this rebind every enrich/topic_cluster Gemini cost row in a dev
    agent run lands with agent_id=NULL - hidden from per-agent admin views.
    Rebinding at the single pipeline chokepoint (after lock + config load, so
    the dispatch-time status write has already landed) fixes dev and hardens
    prod regardless of how the outer context was bound.
    """
    from workers.pipeline.runner import PipelineRunner

    # Bypass __init__ (constructs BQ/Firestore/GCS clients) - we only exercise
    # the context-binding seam in isolation.
    r = PipelineRunner.__new__(PipelineRunner)
    r.collection_id = "coll-1"
    r._status_doc = {"user_id": "user-1", "org_id": "org-1"}
    r._cost_ctx_token = None

    token = r._bind_cost_context("agent-7")
    try:
        ctx = cost_meter.get_collection_context()
        assert ctx["user_id"] == "user-1"
        assert ctx["org_id"] == "org-1"
        assert ctx["collection_id"] == "coll-1"
        assert ctx["agent_id"] == "agent-7"
        assert r._cost_ctx_token is token
    finally:
        cost_meter.reset_collection_context(token)

    # After reset, the agent context is gone again (no leakage).
    assert cost_meter.get_collection_context() == {}
