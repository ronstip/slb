"""Unit tests for the cost_meter row builder + threaded insert.

We don't actually hit BigQuery — `api.deps.get_bq` is monkey-patched so we
can capture the row that *would* be inserted, then assert on its shape.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from api.services import cost_meter


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


def _wait_for_rows(fake_bq: _FakeBQ, n: int = 1, timeout: float = 2.0) -> None:
    """Block until the daemon thread inside log_cost has flushed `n` rows."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(fake_bq.rows) >= n:
            return
        time.sleep(0.01)
    raise AssertionError(f"cost_meter never inserted {n} rows (got {len(fake_bq.rows)})")


def test_log_cost_writes_row_with_expected_shape(fake_bq: _FakeBQ):
    cost_meter.log_cost(
        provider="gemini",
        user_id="u1",
        feature="chat",
        event_type=cost_meter.EVENT_LLM,
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        session_id="sess",
        request_id="rid-test",
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    # Required identity columns.
    assert row["event_type"] == "llm_call"
    assert row["user_id"] == "u1"
    assert row["session_id"] == "sess"
    assert row["request_id"] == "rid-test"
    # Cost columns — gemini-3-flash-preview: $0.50 + $3.00 = $3.50/M tok.
    assert row["provider"] == "gemini"
    assert row["model"] == "gemini-3-flash-preview"
    assert row["feature"] == "chat"
    assert row["input_tokens"] == 1_000_000
    assert row["output_tokens"] == 1_000_000
    assert row["cost_micros"] == 3_500_000


def test_log_cost_honors_override(fake_bq: _FakeBQ):
    # cost_micros_override bypasses the rate-table lookup. Used by the
    # grounding capture path where rates are computed via a specialised
    # helper.
    cost_meter.log_cost(
        provider="google_search",
        user_id="u1",
        feature="chat",
        event_type=cost_meter.EVENT_LLM,
        model="gemini-3-flash-preview",
        units=3,
        unit_kind="queries",
        cost_micros_override=42_000,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["provider"] == "google_search"
    assert row["cost_micros"] == 42_000
    assert row["units"] == 3


def test_log_cost_apify_uses_provider_reported(fake_bq: _FakeBQ):
    cost_meter.log_cost(
        provider="apify",
        user_id="u1",
        feature="scrape",
        event_type=cost_meter.EVENT_PROVIDER,
        units=42,
        unit_kind="posts",
        provider_reported_cost_usd=0.0123,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["provider"] == "apify"
    assert row["cost_micros"] == 12_300
    assert row["units"] == 42
    assert row["unit_kind"] == "posts"


def test_log_cost_swallows_insert_failure(fake_bq: _FakeBQ, monkeypatch):
    class _BoomBQ:
        def insert_rows(self, *a, **kw):  # noqa: ANN001, D401
            raise RuntimeError("BQ down")

    monkeypatch.setattr("api.deps.get_bq", lambda: _BoomBQ())

    # Must not raise.
    cost_meter.log_cost(
        provider="gemini",
        user_id="u1",
        feature="chat",
        model="gemini-3-flash-preview",
        input_tokens=1,
    )
    # Give the thread a beat to finish — we just need to confirm no exception
    # leaked into the calling thread.
    time.sleep(0.05)


def test_log_cost_unknown_provider_still_writes_row_with_null_cost(fake_bq: _FakeBQ):
    cost_meter.log_cost(
        provider="not-a-real-provider",
        user_id="u1",
        feature="scrape",
        units=10,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["provider"] == "not-a-real-provider"
    assert row["cost_micros"] is None
    assert row["units"] == 10


def test_log_cost_picks_up_request_id_from_contextvar(fake_bq: _FakeBQ):
    from api.middleware.request_id import set_request_id

    set_request_id("rid-ctx")
    try:
        cost_meter.log_cost(
            provider="apify",
            user_id="u1",
            feature="scrape",
            provider_reported_cost_usd=0.01,
        )
        _wait_for_rows(fake_bq)
        assert fake_bq.rows[0]["request_id"] == "rid-ctx"
    finally:
        set_request_id(None)


# ── log_gemini_response ──────────────────────────────────────────────


def _fake_gemini_response(
    prompt=1_000_000, candidates=1_000_000, cached=0, thoughts=0,
    model="gemini-3-flash-preview",
):
    from types import SimpleNamespace
    return SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt,
            candidates_token_count=candidates,
            cached_content_token_count=cached,
            thoughts_token_count=thoughts,
        ),
        model_version=model,
    )


def test_log_gemini_response_writes_llm_row(fake_bq: _FakeBQ):
    cost_meter.log_gemini_response(
        _fake_gemini_response(),
        feature="enrich",
        user_id="u1",
        collection_id="c1",
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["event_type"] == "llm_call"
    assert row["provider"] == "gemini"
    assert row["feature"] == "enrich"
    assert row["model"] == "gemini-3-flash-preview"
    assert row["collection_id"] == "c1"
    assert row["cost_micros"] == 3_500_000


def test_log_gemini_response_inherits_collection_context(fake_bq: _FakeBQ):
    with cost_meter.collection_context_scope(
        user_id="u-ctx", org_id="o-ctx",
        collection_id="c-ctx", agent_id="a-ctx",
    ):
        cost_meter.log_gemini_response(_fake_gemini_response(), feature="enrich")
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["user_id"] == "u-ctx"
    assert row["org_id"] == "o-ctx"
    assert row["collection_id"] == "c-ctx"
    assert row["agent_id"] == "a-ctx"


def test_log_gemini_response_no_usage_is_silent(fake_bq: _FakeBQ):
    from types import SimpleNamespace
    cost_meter.log_gemini_response(
        SimpleNamespace(usage_metadata=None, model_version="x"),
        feature="enrich",
        user_id="u1",
    )
    time.sleep(0.05)
    assert fake_bq.rows == []
