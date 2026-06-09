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
        lambda *a, **k: cost_rates.DEFAULT_APIFY_ASSUMED_PER_POST_USD,
    )
    # Default: no matrix override → estimator falls back to the legacy seed
    # rates, so the exact-value assertions above stay deterministic. Individual
    # tests override this to assert the matrix IS consulted.
    monkeypatch.setattr(ce, "get_scraper_rate", lambda *a, **k: None)


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


def test_channel_mode_bills_channel_rate(monkeypatch):
    # In channel mode the crawl bills at the CHANNEL rate cell (kind="channel"),
    # not the posts rate. Stub get_scraper_rate to price channel ≠ posts.
    monkeypatch.setattr(
        ce, "get_scraper_rate",
        lambda prov, plat=None, kind="posts": 0.01 if kind == "channel" else 0.001,
    )
    got = ce.estimate_run_cost_micros(
        n_posts=100,
        provider_platform_pairs=[("brightdata", "youtube")],
        channel_mode=True,
        enrichment_enabled=False,
    )
    # 100 × $0.01 (channel) = $1.00 = 1_000_000 × 1.2 buffer = 1_200_000.
    assert got == 1_200_000


def test_channel_mode_off_uses_posts_rate(monkeypatch):
    monkeypatch.setattr(
        ce, "get_scraper_rate",
        lambda prov, plat=None, kind="posts": 0.01 if kind == "channel" else 0.001,
    )
    got = ce.estimate_run_cost_micros(
        n_posts=100,
        provider_platform_pairs=[("brightdata", "youtube")],
        channel_mode=False,
        enrichment_enabled=False,
    )
    # 100 × $0.001 (posts) = $0.10 = 100_000 × 1.2 = 120_000.
    assert got == 120_000


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


def test_estimate_uses_scraper_matrix_override(monkeypatch):
    """Admin edits to the per-(provider, platform) scraper matrix must flow into
    the pre-flight estimate exactly like they do in the live cost meter.

    Without the fix the estimator read only the legacy COST_RATES path and
    ignored `scraper_rates_per_platform`, so a matrix edit changed live billing
    but not the gate's estimate (under-estimate → run could exceed the wallet).
    """
    # Admin raised BrightData to $0.01/record in the matrix (4× the seed 0.0025).
    monkeypatch.setattr(
        ce, "get_scraper_rate",
        lambda provider, platform=None, kind="posts": 0.01 if provider == "brightdata" else None,
    )
    got = ce.estimate_run_cost_micros(
        n_posts=100, providers=["brightdata"], enrichment_enabled=False,
    )
    # 100 × $0.01 = $1.00 = 1_000_000 micros × 1.2 buffer = 1_200_000.
    assert got == 1_200_000


def test_estimate_matrix_override_is_per_platform(monkeypatch):
    """A per-platform matrix cell is consulted with the platform, so editing one
    platform's cell moves the estimate for that platform only."""
    calls: list[tuple] = []

    def _rate(provider, platform=None, kind="posts"):
        calls.append((provider, platform, kind))
        return 0.02 if (provider == "brightdata" and platform == "youtube") else None

    monkeypatch.setattr(ce, "get_scraper_rate", _rate)
    got = ce.estimate_run_cost_micros(
        n_posts=10,
        provider_platform_pairs=[("brightdata", "youtube")],
        enrichment_enabled=False,
    )
    # 10 × $0.02 = $0.20 = 200_000 × 1.2 = 240_000.
    assert got == 240_000
    assert ("brightdata", "youtube", "posts") in calls


def test_search_grounding_adds_cost():
    no_search = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=False,
    )
    with_search = ce.estimate_run_cost_micros(
        n_posts=10, providers=["brightdata"], enrichment_enabled=False,
        search_grounding=True, n_search_queries=5,
    )
    assert with_search > no_search
