"""Unit tests for the cost-rate computation helper."""

import pytest

from config.cost_rates import (
    COST_RATES,
    PROVIDER_REPORTED,
    _gemini_family,
    compute_cost_micros,
    compute_grounding_cost_micros,
)


# ── gemini ────────────────────────────────────────────────────────────


def test_gemini_known_model_basic_math():
    # gemini-3-flash-preview: $0.50 / $3.00 / $0.05 per 1M tokens (confirmed
    # from https://ai.google.dev/gemini-api/docs/pricing).
    micros = compute_cost_micros(
        "gemini",
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )
    # 1M * 0.50 + 1M * 3.00 = $3.50 = 3_500_000 micros.
    assert micros == 3_500_000


def test_gemini_cached_tokens_billed_at_cache_rate():
    micros = compute_cost_micros(
        "gemini",
        model="gemini-3-flash-preview",
        input_tokens=1_000_000,
        output_tokens=0,
        cached_tokens=1_000_000,
    )
    # All input is cached: 1M * 0.05 = $0.05 = 50_000 micros.
    assert micros == 50_000


def test_gemini_pro_uses_pro_rates():
    micros = compute_cost_micros(
        "gemini",
        model="gemini-3-pro-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
    )
    # 1M * 2.00 + 1M * 12.00 = $14.00 = 14_000_000 micros.
    assert micros == 14_000_000


def test_gemini_unknown_model_falls_back_to_star():
    fallback_rate = COST_RATES["gemini"]["*"]
    micros = compute_cost_micros(
        "gemini",
        model="some-future-model",
        input_tokens=1_000_000,
        output_tokens=0,
    )
    assert micros == int(round(fallback_rate["input_per_mtok"] * 1_000_000 / 1_000_000 * 1e6))


def test_gemini_no_tokens_returns_zero():
    assert compute_cost_micros("gemini", model="gemini-3-flash-preview") == 0


# ── apify (provider-reported) ────────────────────────────────────────


def test_apify_uses_provider_reported_cost():
    assert COST_RATES["apify"] == PROVIDER_REPORTED
    micros = compute_cost_micros("apify", provider_reported_cost_usd=0.0123)
    assert micros == 12_300


def test_apify_without_provider_reported_returns_none():
    assert compute_cost_micros("apify") is None


# ── brightdata ───────────────────────────────────────────────────────


def test_brightdata_per_record_uses_fallback_when_dataset_unknown():
    micros = compute_cost_micros("brightdata", units=1000, sub_kind="unknown_ds")
    # Fallback "*": $0.0025 per record × 1000 = $2.50 = 2_500_000 micros.
    assert micros == 2_500_000


# ── x_api ────────────────────────────────────────────────────────────


def test_x_api_search_per_post():
    micros = compute_cost_micros("x_api", units=10, sub_kind="search_per_post")
    # 10 × $0.005 = $0.05 = 50_000 micros (X pay-per-use 2026 read rate).
    assert micros == 50_000


def test_x_api_lookup_per_call():
    micros = compute_cost_micros("x_api", units=5, sub_kind="lookup_per_call")
    # 5 × $0.005 = $0.025 = 25_000 micros.
    assert micros == 25_000


def test_x_api_owned_read_uses_cheaper_rate():
    micros = compute_cost_micros("x_api", units=100, sub_kind="owned_read")
    # 100 × $0.001 = $0.10 = 100_000 micros (owned-resource read rate).
    assert micros == 100_000


# ── vetric ───────────────────────────────────────────────────────────


def test_vetric_per_call():
    micros = compute_cost_micros("vetric", units=4)
    # 4 × $0.0005 = $0.002 = 2_000 micros.
    assert micros == 2_000


# ── bq ───────────────────────────────────────────────────────────────


def test_bq_dry_run_bytes_to_cost():
    # 1 TiB processed at $5/TB → $5 = 5_000_000 micros.
    micros = compute_cost_micros("bq", bytes_processed=1024 ** 4)
    assert micros == 5_000_000


# ── gcs ──────────────────────────────────────────────────────────────


def test_gcs_egress():
    micros = compute_cost_micros("gcs", units=10, unit_kind="egress")
    # 10 GB × $0.12 = $1.20 = 1_200_000 micros.
    assert micros == 1_200_000


def test_gcs_stored():
    micros = compute_cost_micros("gcs", units=100, unit_kind="stored")
    # 100 GB × $0.020 = $2.00 = 2_000_000 micros.
    assert micros == 2_000_000


def test_gcs_unknown_unit_kind_returns_none():
    assert compute_cost_micros("gcs", units=10, unit_kind="weird") is None


# ── Google Search Grounding ──────────────────────────────────────────


def test_gemini_family_mapping():
    assert _gemini_family("gemini-3-flash-preview") == "gemini-3"
    assert _gemini_family("gemini-3-pro-preview") == "gemini-3"
    assert _gemini_family("gemini-2.5-flash") == "gemini-2.5"
    assert _gemini_family("gemini-2.5-pro") == "gemini-2.5"
    assert _gemini_family("some-other-model") == "*"
    assert _gemini_family(None) == "*"


def test_grounding_gemini_3_billed_per_query():
    # Gemini 3: $14 per 1000 queries → $0.014 per query.
    micros = compute_grounding_cost_micros(
        "gemini-3-flash-preview", queries_executed=10,
    )
    # 10 × $0.014 = $0.14 = 140_000 micros.
    assert micros == 140_000


def test_grounding_gemini_25_billed_per_prompt():
    # Gemini 2.5: $35 per 1000 grounded prompts → $0.035 per prompt.
    micros = compute_grounding_cost_micros(
        "gemini-2.5-flash", prompts_grounded=1,
    )
    assert micros == 35_000


def test_grounding_gemini_3_ignores_per_prompt_arg():
    # Wrong dimension for the family — should not bill.
    assert (
        compute_grounding_cost_micros("gemini-3-flash-preview", prompts_grounded=5)
        is None
    )


def test_grounding_no_queries_returns_none():
    assert (
        compute_grounding_cost_micros("gemini-3-flash-preview", queries_executed=0)
        is None
    )


def test_grounding_unknown_model_falls_back_to_per_prompt():
    # Unknown family bills at the safer over-estimate (gemini-2.5 rate).
    micros = compute_grounding_cost_micros("some-model", prompts_grounded=1)
    assert micros == 35_000


# ── unknown providers ────────────────────────────────────────────────


def test_unknown_provider_returns_none():
    assert compute_cost_micros("not-a-provider") is None
