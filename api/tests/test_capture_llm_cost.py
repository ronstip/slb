"""Tests for the ADK after_model_callback that logs Gemini cost rows.

The callback is invoked by ADK with (callback_context, llm_response). We
stub both with simple namespaces because the production types are pydantic
models with heavy dependencies; the callback only reads a few attributes.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any

import pytest

from api.agent.callbacks import capture_llm_cost


class _FakeBQ:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def insert_rows(self, table: str, rows: list[dict]) -> int:
        assert table == "usage_events"
        self.rows.extend(rows)
        return 0


@pytest.fixture()
def fake_bq(monkeypatch):
    fake = _FakeBQ()
    monkeypatch.setattr("api.deps.get_bq", lambda: fake)
    return fake


def _ctx(state: dict | None = None, agent_name: str = "agent", user_id: str = "u1"):
    return SimpleNamespace(
        state=state or {"user_id": user_id, "org_id": "o1", "session_id": "s1"},
        agent_name=agent_name,
        user_id=user_id,
        session=SimpleNamespace(id="s1"),
    )


def _llm_response(
    *,
    prompt: int = 1_000_000,
    candidates: int = 1_000_000,
    cached: int = 0,
    thoughts: int = 0,
    model_version: str = "gemini-3-flash-preview",
    grounding_queries: list[str] | None = None,
):
    usage = SimpleNamespace(
        prompt_token_count=prompt,
        candidates_token_count=candidates,
        cached_content_token_count=cached,
        thoughts_token_count=thoughts,
    )
    grounding_metadata = (
        SimpleNamespace(web_search_queries=grounding_queries)
        if grounding_queries is not None
        else None
    )
    return SimpleNamespace(
        usage_metadata=usage,
        model_version=model_version,
        grounding_metadata=grounding_metadata,
    )


def _wait_for_rows(fake_bq: _FakeBQ, n: int = 1, timeout: float = 2.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(fake_bq.rows) >= n:
            return
        time.sleep(0.01)
    raise AssertionError(f"capture_llm_cost wrote {len(fake_bq.rows)} rows; expected {n}")


def test_chat_mode_writes_cost_row_with_expected_shape(fake_bq: _FakeBQ):
    capture_llm_cost(_ctx(), _llm_response())
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["provider"] == "gemini"
    assert row["feature"] == "chat"
    assert row["event_type"] == "llm_call"
    assert row["model"] == "gemini-3-flash-preview"
    assert row["input_tokens"] == 1_000_000
    assert row["output_tokens"] == 1_000_000
    # gemini-3-flash-preview: $0.50 + $3.00 = $3.50/M tok = 3_500_000 micros.
    assert row["cost_micros"] == 3_500_000
    assert row["user_id"] == "u1"
    assert row["session_id"] == "s1"


def test_autonomous_mode_tagged_correctly(fake_bq: _FakeBQ):
    capture_llm_cost(_ctx(agent_name="executor"), _llm_response())
    _wait_for_rows(fake_bq)
    assert fake_bq.rows[0]["feature"] == "autonomous"


def test_subagent_tagged_with_name(fake_bq: _FakeBQ):
    capture_llm_cost(_ctx(agent_name="google_search_agent"), _llm_response())
    _wait_for_rows(fake_bq)
    assert fake_bq.rows[0]["feature"] == "subagent:google_search_agent"


def test_thinking_tokens_billed_at_output_rate(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(prompt=0, candidates=500_000, thoughts=500_000),
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    # 1M total output tokens × $3.00/M = $3.00 = 3_000_000 micros.
    assert row["output_tokens"] == 1_000_000
    assert row["cost_micros"] == 3_000_000


def test_cached_tokens_propagated(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(prompt=1_000_000, candidates=0, cached=1_000_000),
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["cached_tokens"] == 1_000_000
    # All input is cached → 1M × $0.05/M = $0.05 = 50_000 micros.
    assert row["cost_micros"] == 50_000


# ── Google Search Grounding ─────────────────────────────────────────


def test_grounded_call_emits_two_rows_tokens_plus_grounding(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(grounding_queries=["query 1", "query 2", "query 3"]),
    )
    _wait_for_rows(fake_bq, n=2)
    by_provider = {r["provider"]: r for r in fake_bq.rows}
    assert set(by_provider) == {"gemini", "google_search"}

    # Token row: standard chat shape.
    tok = by_provider["gemini"]
    assert tok["event_type"] == "llm_call"
    assert tok["cost_micros"] == 3_500_000

    # Grounding row: per-query, Gemini 3 family (signaled via unit_kind).
    g = by_provider["google_search"]
    assert g["event_type"] == "llm_call"
    assert g["units"] == 3
    assert g["unit_kind"] == "queries"
    assert g["model"] == "gemini-3-flash-preview"
    # 3 × $0.014 = $0.042 = 42_000 micros.
    assert g["cost_micros"] == 42_000


def test_grounded_call_gemini_25_billed_per_prompt(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(
            model_version="gemini-2.5-flash",
            grounding_queries=["q1", "q2", "q3", "q4"],
        ),
    )
    _wait_for_rows(fake_bq, n=2)
    grounding = next(r for r in fake_bq.rows if r["provider"] == "google_search")
    assert grounding["model"] == "gemini-2.5-flash"
    assert grounding["units"] == 1
    assert grounding["unit_kind"] == "prompts"
    # 1 × $0.035 = $0.035 = 35_000 micros (regardless of query count).
    assert grounding["cost_micros"] == 35_000


def test_grounding_metadata_with_empty_queries_emits_only_token_row(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(grounding_queries=[]),
    )
    _wait_for_rows(fake_bq, n=1)
    time.sleep(0.05)  # give a daemon thread a beat to definitely-not-emit.
    assert len(fake_bq.rows) == 1
    assert fake_bq.rows[0]["provider"] == "gemini"


def test_grounding_metadata_strips_empty_query_strings(fake_bq: _FakeBQ):
    capture_llm_cost(
        _ctx(),
        _llm_response(grounding_queries=["valid", "", "also valid", ""]),
    )
    _wait_for_rows(fake_bq, n=2)
    grounding = next(r for r in fake_bq.rows if r["provider"] == "google_search")
    # Only 2 non-empty queries counted.
    assert grounding["units"] == 2
    assert grounding["cost_micros"] == 28_000


def test_no_grounding_metadata_emits_only_token_row(fake_bq: _FakeBQ):
    # grounding_metadata is None — no second row.
    capture_llm_cost(_ctx(), _llm_response())
    _wait_for_rows(fake_bq, n=1)
    time.sleep(0.05)
    assert len(fake_bq.rows) == 1
    assert fake_bq.rows[0]["provider"] == "gemini"


def test_no_usage_metadata_is_silent(fake_bq: _FakeBQ):
    ctx = _ctx()
    resp = SimpleNamespace(usage_metadata=None, model_version="gemini-3-flash-preview")
    capture_llm_cost(ctx, resp)
    # Give thread a beat to confirm no row.
    time.sleep(0.05)
    assert fake_bq.rows == []


def test_zero_tokens_is_silent(fake_bq: _FakeBQ):
    capture_llm_cost(_ctx(), _llm_response(prompt=0, candidates=0, thoughts=0))
    time.sleep(0.05)
    assert fake_bq.rows == []


def test_does_not_raise_on_internal_failure(monkeypatch):
    # Force the cost_meter to blow up; the callback must still return None.
    def _boom(*a, **kw):
        raise RuntimeError("kaboom")

    monkeypatch.setattr("api.services.cost_meter.log_cost", _boom)
    # Must not raise.
    assert capture_llm_cost(_ctx(), _llm_response()) is None
