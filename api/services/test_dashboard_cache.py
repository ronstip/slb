"""Tests for the dashboard response cache.

The cache short-circuits the expensive BigQuery read + per-row serialization for
repeat loads of the same `(agent_id, collection_ids)` data. Invalidation is
*passive*: the cache key includes a freshness stamp derived from
`collection_status.updated_at`, which the pipeline bumps whenever post counts
change (new posts / enrichment / refresh). So static data stays cached for a long
time (up to the TTL safety net), and changed data busts the key immediately.
"""

import threading

from api.services.dashboard_cache import (
    DashboardCache,
    make_freshness_stamp,
)


def _core(n: int = 1) -> dict:
    return {"posts": [{"post_id": str(i)} for i in range(n)], "topics": [], "truncated": False}


# ─── key normalization ──────────────────────────────────────────────


def test_collection_id_order_does_not_matter():
    c = DashboardCache()
    core = _core()
    c.set("agent1", ["b", "a"], "s1", core)
    assert c.get("agent1", ["a", "b"], "s1") == core


def test_different_agent_misses():
    c = DashboardCache()
    c.set("agent1", ["a"], "s1", _core())
    assert c.get("agent2", ["a"], "s1") is None


def test_cold_key_returns_none():
    c = DashboardCache()
    assert c.get("agent1", ["a"], "s1") is None


def test_set_then_get_roundtrip():
    c = DashboardCache()
    core = _core(3)
    c.set("agent1", ["a"], "s1", core)
    assert c.get("agent1", ["a"], "s1") is core


# ─── passive invalidation via freshness stamp ───────────────────────


def test_changed_stamp_misses():
    """A new freshness stamp (data changed) must not hit the stale entry."""
    c = DashboardCache()
    c.set("agent1", ["a"], "stamp-old", _core(1))
    assert c.get("agent1", ["a"], "stamp-new") is None
    # old entry still addressable by its old stamp until TTL/eviction
    assert c.get("agent1", ["a"], "stamp-old") is not None


# ─── TTL safety net (no sleeping; inject the timer) ─────────────────


def test_ttl_expiry_with_injected_timer():
    now = {"t": 1000.0}
    c = DashboardCache(ttl=300, timer=lambda: now["t"])
    c.set("agent1", ["a"], "s1", _core())
    assert c.get("agent1", ["a"], "s1") is not None
    now["t"] += 301  # advance past TTL
    assert c.get("agent1", ["a"], "s1") is None


# ─── freshness stamp derivation ─────────────────────────────────────


def test_make_freshness_stamp_picks_max_iso():
    statuses = [
        {"updated_at": "2026-01-01T00:00:00+00:00"},
        {"updated_at": "2026-06-01T12:00:00+00:00"},
        {"updated_at": "2026-03-01T00:00:00+00:00"},
    ]
    assert make_freshness_stamp(statuses) == "2026-06-01T12:00:00+00:00"


def test_make_freshness_stamp_ignores_none_and_missing():
    statuses = [None, {}, {"updated_at": "2026-02-02T00:00:00+00:00"}, {"updated_at": None}]
    assert make_freshness_stamp(statuses) == "2026-02-02T00:00:00+00:00"


def test_make_freshness_stamp_empty_is_stable_string():
    # No timestamps anywhere -> a stable, non-None key component (still cacheable).
    assert make_freshness_stamp([None, {}]) == ""
    assert make_freshness_stamp([]) == ""


def test_make_freshness_stamp_accepts_datetime_like():
    """Some callers may pass non-isoformatted values; stringify consistently."""
    class _Dt:
        def isoformat(self):
            return "2026-05-05T00:00:00+00:00"

    out = make_freshness_stamp([{"updated_at": _Dt()}, {"updated_at": "2026-01-01T00:00:00+00:00"}])
    assert out == "2026-05-05T00:00:00+00:00"


# ─── thread-safety smoke ────────────────────────────────────────────


def test_concurrent_access_does_not_error():
    c = DashboardCache()

    def worker(i: int):
        for _ in range(200):
            c.set("agent1", ["a", str(i)], "s1", _core(i))
            c.get("agent1", ["a", str(i)], "s1")

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # If we got here without raising, concurrent access is safe.
    assert c.get("agent1", ["a", "0"], "s1") is not None
