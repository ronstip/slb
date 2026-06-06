"""Unit tests for the cost_meter row builder + threaded insert.

We don't actually hit BigQuery - `api.deps.get_bq` is monkey-patched so we
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


class _FakeFS:
    """Records wallet deductions so tests stay hermetic (no real Firestore)."""

    def __init__(self) -> None:
        self.deductions: list[tuple[str, int]] = []

    def apply_spend_micros(self, uid: str, micros: int) -> None:
        self.deductions.append((uid, micros))


@pytest.fixture(autouse=True)
def _default_margin(monkeypatch):
    """Pin the profit margin to 1.0 so default-margin assertions don't depend on
    the dev Firestore pricing doc / process-cached pricing. cost_meter imports
    `get_margin_multiplier` lazily at call time, so patching the module attr
    takes effect. The margin-specific test re-patches to its own value."""
    monkeypatch.setattr("config.cost_rates.get_margin_multiplier", lambda: 1.0)


@pytest.fixture()
def fake_bq(monkeypatch):
    fake = _FakeBQ()
    monkeypatch.setattr("api.deps.get_bq", lambda: fake)
    # Keep wallet deduction hermetic too - cost_meter now calls get_fs().
    monkeypatch.setattr("api.deps.get_fs", lambda: _FakeFS())
    return fake


@pytest.fixture()
def fake_fs(monkeypatch):
    fake = _FakeFS()
    monkeypatch.setattr("api.deps.get_fs", lambda: fake)
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
    # Cost columns - gemini-3-flash-preview: $0.50 + $3.00 = $3.50/M tok.
    assert row["provider"] == "gemini"
    assert row["model"] == "gemini-3-flash-preview"
    assert row["feature"] == "chat"
    assert row["input_tokens"] == 1_000_000
    assert row["output_tokens"] == 1_000_000
    assert row["cost_micros"] == 3_500_000
    # Default margin is 1.0 → billed == cost.
    assert row["billed_micros"] == 3_500_000


def test_log_cost_deducts_from_wallet(monkeypatch):
    bq = _FakeBQ()
    fs = _FakeFS()
    monkeypatch.setattr("api.deps.get_bq", lambda: bq)
    monkeypatch.setattr("api.deps.get_fs", lambda: fs)
    cost_meter.log_cost(
        provider="gemini",
        user_id="u1",
        feature="chat",
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )
    _wait_for_rows(bq)
    # Deduction runs after the insert on the same daemon thread.
    deadline = time.time() + 2.0
    while time.time() < deadline and not fs.deductions:
        time.sleep(0.01)
    assert fs.deductions == [("u1", 3_500_000)]


def test_log_cost_applies_margin_to_billed_and_wallet(monkeypatch):
    # §E profit margin: wallet is debited cost × margin, and the row records
    # both the raw cost and the billed (revenue) amount.
    bq = _FakeBQ()
    fs = _FakeFS()
    monkeypatch.setattr("api.deps.get_bq", lambda: bq)
    monkeypatch.setattr("api.deps.get_fs", lambda: fs)
    # cost_meter does `from config.cost_rates import get_margin_multiplier`
    # at call time, so patching the module attribute takes effect.
    monkeypatch.setattr("config.cost_rates.get_margin_multiplier", lambda: 2.0)

    cost_meter.log_cost(
        provider="gemini",
        user_id="u1",
        feature="chat",
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )
    _wait_for_rows(bq)
    row = bq.rows[0]
    assert row["cost_micros"] == 3_500_000
    assert row["billed_micros"] == 7_000_000  # 3.5M × 2.0
    deadline = time.time() + 2.0
    while time.time() < deadline and not fs.deductions:
        time.sleep(0.01)
    assert fs.deductions == [("u1", 7_000_000)]  # wallet debited the BILLED amount


def test_log_cost_null_cost_has_null_billed_and_no_deduction(monkeypatch):
    bq = _FakeBQ()
    fs = _FakeFS()
    monkeypatch.setattr("api.deps.get_bq", lambda: bq)
    monkeypatch.setattr("api.deps.get_fs", lambda: fs)
    cost_meter.log_cost(
        provider="not-a-real-provider",
        user_id="u1",
        feature="scrape",
        units=10,
    )
    _wait_for_rows(bq)
    row = bq.rows[0]
    assert row["cost_micros"] is None
    assert row["billed_micros"] is None
    time.sleep(0.05)
    assert fs.deductions == []  # nothing to charge on a rate-table miss


def test_log_cost_comments_feature_prices_via_comment_matrix(monkeypatch):
    # A `feature="comments"` scrape must price through the comments rate
    # matrix; a `feature="scrape"` call hits the posts rate. No explicit
    # scrape_kind is passed - it's derived from the feature.
    import config.cost_rates as cost_rates

    bq = _FakeBQ()
    monkeypatch.setattr("api.deps.get_bq", lambda: bq)
    monkeypatch.setattr("api.deps.get_fs", lambda: _FakeFS())
    monkeypatch.setattr(cost_rates, "_load_pricing_doc", lambda: {
        "scraper_rates_per_platform": {"x_api": {"twitter": 0.005}},
        "scraper_comment_rates_per_platform": {"x_api": {"twitter": 0.02}},
    })
    cost_rates.invalidate_pricing_cache()
    try:
        cost_meter.log_cost(
            provider="x_api", user_id="u1", feature="comments",
            platform="twitter", units=10,
        )
        cost_meter.log_cost(
            provider="x_api", user_id="u1", feature="scrape",
            platform="twitter", units=10,
        )
        _wait_for_rows(bq, n=2)
    finally:
        cost_rates.invalidate_pricing_cache()

    by_feature = {r["feature"]: r for r in bq.rows}
    assert by_feature["comments"]["cost_micros"] == 200_000  # 10 × $0.02
    assert by_feature["scrape"]["cost_micros"] == 50_000     # 10 × $0.005


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
    # Give the thread a beat to finish - we just need to confirm no exception
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


def test_log_cost_inherits_user_id_from_collection_context(fake_bq: _FakeBQ):
    """Apify-style call sites pass user_id="" and rely on the bound
    collection context (set by workers/server.py at task entry). Without
    the fallback, those rows land with empty user_id and the admin
    user-detail query (WHERE user_id = @uid) hides them - the root cause
    of the "only Brightdata showing" bug. This test pins the fallback in
    place so the regression can't sneak back."""
    with cost_meter.collection_context_scope(
        user_id="owner-uid", org_id="org-1", collection_id="col-1", agent_id="agent-1",
    ):
        cost_meter.log_cost(
            provider="apify",
            user_id="",            # adapter doesn't know the owner here
            feature="scrape",
            provider_reported_cost_usd=0.05,
        )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["user_id"] == "owner-uid"
    assert row["org_id"] == "org-1"
    assert row["collection_id"] == "col-1"
    assert row["agent_id"] == "agent-1"


def test_log_cost_default_cost_source_provider_reported(fake_bq: _FakeBQ):
    """When the caller supplies `provider_reported_cost_usd`, the row's
    cost_source defaults to "provider_reported" so the admin UI can
    distinguish provider-reported charges from estimates without the
    call site needing to set the label explicitly."""
    cost_meter.log_cost(
        provider="apify",
        user_id="u1",
        feature="scrape",
        platform="instagram",
        provider_reported_cost_usd=0.05,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["cost_source"] == cost_meter.COST_SOURCE_PROVIDER_REPORTED
    assert row["platform"] == "instagram"


def test_log_cost_default_cost_source_rate_table(fake_bq: _FakeBQ):
    """Gemini token rows go through compute_cost_micros (rate table); the
    default cost_source label is "rate_table" so an admin can tell at a
    glance which rows are looked up vs reported vs estimated."""
    cost_meter.log_cost(
        provider="gemini",
        user_id="u1",
        feature="chat",
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["cost_source"] == cost_meter.COST_SOURCE_RATE_TABLE


def test_log_cost_explicit_estimated_fallback(fake_bq: _FakeBQ):
    """Apify adapter explicitly stamps `estimated_fallback` when it had to
    compute cost from `apify_assumed_per_post_usd` instead of trusting a
    provider-reported number."""
    cost_meter.log_cost(
        provider="apify",
        user_id="u1",
        feature="scrape",
        platform="tiktok",
        provider_reported_cost_usd=0.04,  # synthesized from assumed × posts
        cost_source=cost_meter.COST_SOURCE_ESTIMATED_FALLBACK,
    )
    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["cost_source"] == "estimated_fallback"
    assert row["platform"] == "tiktok"


def test_start_thread_with_cost_context_propagates_ctx(fake_bq: _FakeBQ):
    """Plain `threading.Thread` does NOT inherit ContextVars from its
    parent thread - a child thread sees the default (empty) context. This
    silently dropped user_id+agent_id from every Apify cost row fired from
    its per-platform worker threads. `start_thread_with_cost_context`
    captures the parent context and re-runs the target inside it.

    Pins the helper's behavior so we don't regress to the threading bug
    that hid crawler events from per-agent Recent Activity."""
    with cost_meter.collection_context_scope(
        user_id="thread-uid", org_id="thread-org",
        collection_id="thread-col", agent_id="thread-agent",
    ):
        def _child() -> None:
            cost_meter.log_cost(
                provider="apify",
                user_id="",         # falls back to ctx
                feature="scrape",
                platform="facebook",
                provider_reported_cost_usd=0.02,
            )

        t = cost_meter.start_thread_with_cost_context(_child, daemon=True)
        t.start()
        t.join(timeout=2)

    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["user_id"] == "thread-uid"
    assert row["agent_id"] == "thread-agent"
    assert row["collection_id"] == "thread-col"
    assert row["platform"] == "facebook"


def test_context_aware_pool_propagates_ctx(fake_bq: _FakeBQ):
    """`ContextAwareThreadPoolExecutor.submit` must capture the parent
    context so priced calls fired from pool workers inherit user_id /
    agent_id. A bare `ThreadPoolExecutor` drops them - this guards the
    enrichment/clustering attribution leak (nested pools logging cost
    with NULL user_id, hidden from per-user/per-agent admin views)."""
    with cost_meter.collection_context_scope(
        user_id="pool-uid", org_id="pool-org",
        collection_id="pool-col", agent_id="pool-agent",
    ):
        with cost_meter.ContextAwareThreadPoolExecutor(max_workers=2) as pool:
            fut = pool.submit(
                cost_meter.log_cost,
                provider="gemini",
                user_id="",  # must fall back to the propagated ctx
                feature="enrich",
                event_type=cost_meter.EVENT_LLM,
                model="gemini-3-flash-preview",
                input_tokens=1_000_000,
                output_tokens=1_000_000,
            )
            fut.result(timeout=2)

    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["user_id"] == "pool-uid"
    assert row["agent_id"] == "pool-agent"
    assert row["collection_id"] == "pool-col"


def test_streaming_runner_pool_propagates_ctx(fake_bq: _FakeBQ):
    """The enrichment work runs inside `StreamingStepRunner`'s internal
    pool. Submitting through that pool from within a bound context must
    keep the attribution - otherwise every `enrich` row lands NULL
    user_id/agent_id (the production undercount bug)."""
    from types import SimpleNamespace

    from workers.pipeline.post_state import PostState
    from workers.pipeline.streaming import StreamingStepRunner

    runner = StreamingStepRunner(
        name="enrich",
        ctx=SimpleNamespace(collection_id="streamcoll1234"),
        claim_state=PostState.READY_FOR_ENRICHMENT,
        in_flight_state=PostState.ENRICHING,
        success_state=PostState.ENRICHED,
        failure_state=PostState.ENRICHMENT_FAILED,
        concurrency=2,
        process_fn=lambda post, ctx: ("ok", None),
        claim_fn=lambda: None,
    )
    try:
        with cost_meter.collection_context_scope(
            user_id="stream-uid", org_id="stream-org",
            collection_id="stream-col", agent_id="stream-agent",
        ):
            fut = runner._executor.submit(
                cost_meter.log_cost,
                provider="gemini",
                user_id="",
                feature="enrich",
                event_type=cost_meter.EVENT_LLM,
                model="gemini-3-flash-preview",
                input_tokens=1_000_000,
                output_tokens=1_000_000,
            )
            fut.result(timeout=2)
    finally:
        runner._executor.shutdown(wait=True)

    _wait_for_rows(fake_bq)
    row = fake_bq.rows[0]
    assert row["user_id"] == "stream-uid"
    assert row["agent_id"] == "stream-agent"


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
