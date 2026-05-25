"""Unit tests for the pre-flight run cost estimator (§E)."""

from __future__ import annotations

import pytest

from api.services import cost_estimate as ce
from config import cost_rates


@pytest.fixture(autouse=True)
def _pin_pricing_to_seed(monkeypatch):
    """Pin rates/margin to the code seed so these exact-value assertions don't
    depend on whatever pricing overrides happen to live in the dev Firestore.

    `cost_estimate` binds these names at import (`from ... import`), so we patch
    them on the `ce` module namespace (not `config.cost_rates`)."""
    monkeypatch.setattr(ce, "get_active_rates", lambda: cost_rates.COST_RATES)
    monkeypatch.setattr(ce, "get_margin_multiplier", lambda: 1.0)
    monkeypatch.setattr(
        ce, "get_apify_assumed_per_post_usd",
        lambda: cost_rates.DEFAULT_APIFY_ASSUMED_PER_POST_USD,
    )


def test_zero_posts_is_zero():
    assert ce.estimate_run_cost_micros(n_posts=0, enrichment_enabled=False) == 0


def test_crawl_only_brightdata_with_buffer():
    # 100 posts × $0.0025 = $0.25 = 250_000 micros × 1.2 buffer = 300_000.
    got = ce.estimate_run_cost_micros(
        n_posts=100, providers=["brightdata"], enrichment_enabled=False,
    )
    assert got == 300_000


def test_picks_most_expensive_provider():
    # max(brightdata 0.0025, x_api 0.005) = 0.005 → 100 × 0.005 = $0.50.
    got = ce.estimate_run_cost_micros(
        n_posts=100, providers=["brightdata", "x_api"], enrichment_enabled=False,
    )
    assert got == 600_000  # 500_000 × 1.2


def test_include_comments_multiplier():
    base = ce.estimate_run_cost_micros(
        n_posts=100, providers=["brightdata"], enrichment_enabled=False,
    )
    withc = ce.estimate_run_cost_micros(
        n_posts=100, providers=["brightdata"], include_comments=True, enrichment_enabled=False,
    )
    assert withc == int(round(base * ce.COMMENTS_MULTIPLIER))


def test_enrichment_adds_gemini_cost():
    crawl_only = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=False,
    )
    with_enrich = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=True,
    )
    assert with_enrich > crawl_only


def test_unknown_provider_uses_default_rate():
    # No providers → DEFAULT_PER_POST_USD (0.005). 100 × 0.005 = $0.50.
    got = ce.estimate_run_cost_micros(n_posts=100, enrichment_enabled=False)
    assert got == 600_000


def test_search_grounding_adds_cost():
    no_search = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=False,
    )
    with_search = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=False,
        search_grounding=True, n_search_queries=5,
    )
    assert with_search > no_search
