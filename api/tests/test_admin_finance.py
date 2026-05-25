"""Unit tests for the admin Finance + UserDetail additions.

Covers:
  - sum_wallet_balance — skips phantom users, sums real wallets only.
  - _agent_cost_breakdown — NULL agent_id rolls into an "Unassigned" bucket;
    real agent_ids hydrate name/icon from the supplied meta map.
  - _finance_breakdown — surfaces unspent_purchased_micros into the response.

We mock the BigQuery + Firestore clients; nothing in this file hits a network.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.routers import admin
from workers.shared.firestore_client import FirestoreClient


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeBQ:
    """Replays scripted rows for whichever SQL the caller passes."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def query(self, *_args, **_kwargs) -> list[dict]:
        return list(self._rows)


class _DocSnap:
    def __init__(self, data: dict) -> None:
        self._data = data

    def to_dict(self) -> dict:
        return dict(self._data)


class _Collection:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def stream(self):
        return [_DocSnap(r) for r in self._rows]


class _Db:
    def __init__(self, by_collection: dict[str, list[dict]]) -> None:
        self._by = by_collection

    def collection(self, name: str) -> _Collection:
        return _Collection(self._by.get(name, []))


# ---------------------------------------------------------------------------
# sum_wallet_balance
# ---------------------------------------------------------------------------


def test_sum_wallet_balance_skips_phantom_docs():
    db = _Db({
        "users": [
            # Real, $5 balance.
            {"email": "real@x.com", "credit": {"balance_micros": 5_000_000, "total_in_micros": 7_000_000, "spent_micros": 2_000_000}},
            # Phantom: no email AND no created_at — apply_spend_micros artifact.
            {"credit": {"balance_micros": 999, "total_in_micros": 999, "spent_micros": 0}},
            # Real, zero balance — still counted in total_in/spent for completeness.
            {"created_at": "2026-05-01T00:00:00Z", "credit": {"balance_micros": 0, "total_in_micros": 3_000_000, "spent_micros": 3_000_000}},
        ]
    })

    fs = FirestoreClient.__new__(FirestoreClient)  # bypass __init__
    fs._db = db

    out = fs.sum_wallet_balance()

    assert out["balance_micros"] == 5_000_000
    assert out["total_in_micros"] == 7_000_000 + 3_000_000
    assert out["spent_micros"] == 2_000_000 + 3_000_000


# ---------------------------------------------------------------------------
# _agent_cost_breakdown
# ---------------------------------------------------------------------------


def test_agent_cost_breakdown_unassigned_bucket(monkeypatch):
    # Two BQ rows: one real agent, one NULL → COALESCE replaces with sentinel.
    rows = [
        {"agent_id": "agent_a", "cost_micros": 8_000_000, "billed_micros": 8_000_000, "events": 12},
        {"agent_id": admin._UNASSIGNED_AGENT_KEY, "cost_micros": 2_000_000, "billed_micros": 2_000_000, "events": 3},
    ]
    monkeypatch.setattr(admin, "get_bq", lambda: _FakeBQ(rows))

    # Agent docs use `title` (real shape); the breakdown surfaces that.
    agent_meta = {"agent_a": {"title": "Research Agent", "icon": "search"}}
    out = admin._agent_cost_breakdown("u1", agent_meta, range_key="all")

    assert len(out) == 2
    first, second = out
    assert first == {
        "agent_id": "agent_a",
        "agent_name": "Research Agent",
        "agent_icon": "search",
        "cost_micros": 8_000_000,
        "billed_micros": 8_000_000,
        "events": 12,
    }
    assert second == {
        "agent_id": None,
        "agent_name": "Unassigned",
        "agent_icon": None,
        "cost_micros": 2_000_000,
        "billed_micros": 2_000_000,
        "events": 3,
    }


def test_agent_cost_breakdown_unknown_agent_falls_back_to_id(monkeypatch):
    """An agent_id not present in the meta map AND not in Firestore is
    rendered with the id as the display name — never drops the row."""
    rows = [
        {"agent_id": "ghost", "cost_micros": 1_000_000, "billed_micros": 1_000_000, "events": 1},
    ]
    monkeypatch.setattr(admin, "get_bq", lambda: _FakeBQ(rows))

    out = admin._agent_cost_breakdown("u1", agent_meta={}, range_key="all")

    assert out == [{
        "agent_id": "ghost",
        "agent_name": "ghost",
        "agent_icon": None,
        "cost_micros": 1_000_000,
        "billed_micros": 1_000_000,
        "events": 1,
    }]


def test_agent_cost_breakdown_hydrates_from_firestore(monkeypatch):
    """An agent_id missing from the preloaded meta map is fetched from
    Firestore on demand — covers deleted/cross-owner agents that still
    appear in BQ usage_events but aren't in `list_user_agents`."""
    rows = [
        {"agent_id": "other_owner_agent", "cost_micros": 5_000_000, "billed_micros": 5_000_000, "events": 4},
    ]
    monkeypatch.setattr(admin, "get_bq", lambda: _FakeBQ(rows))

    calls: list[str] = []

    class _FS:
        def get_agent(self, aid: str):
            calls.append(aid)
            return {"agent_id": aid, "title": "Research Co-pilot", "icon": "search"}

    meta: dict = {}
    out = admin._agent_cost_breakdown("u1", agent_meta=meta, range_key="all", fs=_FS())

    assert calls == ["other_owner_agent"]
    assert out[0]["agent_name"] == "Research Co-pilot"
    assert out[0]["agent_icon"] == "search"
    # And the meta map is memoised — a second call within the same request
    # (e.g. the MTD pass after the all-time pass) won't re-fetch.
    assert "other_owner_agent" in meta


# ---------------------------------------------------------------------------
# _finance_breakdown — passes the new field through
# ---------------------------------------------------------------------------


def test_finance_includes_unspent_purchased_micros(monkeypatch):
    """The wallet-liability snapshot is plumbed end-to-end into the response."""
    monkeypatch.setattr(admin, "get_bq", lambda: _FakeBQ([]))

    out = admin._finance_breakdown(
        range_key="all",
        start=None,
        end=None,
        tier_by_uid={},
        credit={"purchase": 0, "grant": 0, "adjustment": 0, "refund": 0, "other": 0},
        unspent_purchased_micros=1_234_567,
    )

    assert out["unspent_purchased_micros"] == 1_234_567
    # Existing keys still present (regression guard).
    assert "revenue_micros" in out
    assert "granted_micros" in out
    assert "usage_billed_micros" in out
    assert "by_provider" in out
    assert "by_feature" in out
    assert "by_tier" in out
    assert "series" in out


def test_finance_unspent_defaults_to_zero(monkeypatch):
    """Callers that omit the new kwarg get a 0 — not a missing key."""
    monkeypatch.setattr(admin, "get_bq", lambda: _FakeBQ([]))

    out = admin._finance_breakdown(
        range_key="all",
        start=None,
        end=None,
        tier_by_uid={},
        credit={"purchase": 0, "grant": 0, "adjustment": 0, "refund": 0, "other": 0},
    )

    assert out["unspent_purchased_micros"] == 0
