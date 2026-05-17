"""Single source of truth for external-call cost rates.

Edit this file when a provider bumps prices. Nothing else should hard-code
USD numbers. Costs are stored as USD-micros (USD * 1e6) so we never round
through floats; ``compute_cost_micros`` does the conversion.

Numbers are PLACEHOLDERS until confirmed against the latest invoice from
each provider. Update the corresponding ``# TODO: confirm from <provider>
invoice`` line when you do.
"""

from __future__ import annotations

from typing import Any

# A sentinel returned in place of a rate table when the provider reports the
# exact cost on the call itself (e.g. Apify's `run.usage.cost`).
PROVIDER_REPORTED = "use_provider_reported"

# ---------------------------------------------------------------------------
# Rate table
# ---------------------------------------------------------------------------
#
# Shape:
#   gemini:       per-model {input_per_mtok, output_per_mtok, cached_per_mtok}
#   apify:        PROVIDER_REPORTED sentinel — capture run.usage.cost directly
#   brightdata:   per-dataset {per_record_usd}
#   x_api:        per-endpoint {per_unit_usd}
#   vetric:       {per_call_usd}
#   bq:           {per_tb_processed_usd}
#   gcs:          {per_gb_stored_usd, per_gb_egress_usd}
#
# Use "*" as a fallback key when an unrecognised model/dataset id is seen —
# avoids dropping cost on the floor while still flagging drift in logs.

COST_RATES: dict[str, Any] = {
    # ── Gemini API — token-priced models ──────────────────────────────
    # Source: https://ai.google.dev/gemini-api/docs/pricing
    # Rates are USD per 1M tokens. Pro models have tiered pricing by
    # prompt length (≤200K vs >200K); we apply the ≤200K tier here as a
    # reasonable default for the common case. For long-context workloads
    # this may under-bill; revisit if/when we route ≥200K-token prompts.
    "gemini": {
        "gemini-3-flash-preview": {
            "input_per_mtok": 0.50,
            "output_per_mtok": 3.00,
            "cached_per_mtok": 0.05,
        },
        "gemini-3-pro-preview": {
            "input_per_mtok": 2.00,
            "output_per_mtok": 12.00,
            "cached_per_mtok": 0.20,
        },
        "gemini-2.5-flash": {
            "input_per_mtok": 0.30,
            "output_per_mtok": 2.50,
            "cached_per_mtok": 0.03,
        },
        "gemini-2.5-pro": {
            "input_per_mtok": 1.25,
            "output_per_mtok": 10.00,
            "cached_per_mtok": 0.125,
        },
        # Fallback — bills like 3-flash (the codebase default). If we
        # see logs at this rate that means we routed a new/unknown model
        # name and the rate is approximate — update this table.
        "*": {
            "input_per_mtok": 0.50,
            "output_per_mtok": 3.00,
            "cached_per_mtok": 0.05,
        },
    },

    # ── Google Search Grounding (billed separately from tokens) ───────
    # Source: https://ai.google.dev/gemini-api/docs/google-search
    # Gemini 3 family is billed PER SEARCH QUERY the model executes
    # (count from `grounding_metadata.web_search_queries`). Gemini 2.5
    # family is billed PER PROMPT that fires grounding (count = 1 per
    # grounded request).
    "google_search": {
        "gemini-3": {"per_query_usd": 0.014},
        "gemini-2.5": {"per_prompt_usd": 0.035},
        # Unknown model family → bill like Gemini 2.5 (the safer over-
        # estimate). Logged at the site so drift is visible.
        "*": {"per_prompt_usd": 0.035},
    },

    # ── Apify — provider-reported exact cost on the run object ────────
    "apify": PROVIDER_REPORTED,

    # ── BrightData — Web Scraper API + Datasets ───────────────────────
    # Source: https://brightdata.com/pricing/datasets — IG & TikTok
    # datasets at $250 / 100K records = $0.0025/record. The Web Scraper
    # API's pay-per-success price varies by scraper; the dataset
    # marketplace baseline is the closest public anchor we have.
    "brightdata": {
        "*": {"per_record_usd": 0.0025},
    },

    # ── X (Twitter) API — pay-per-use default tier ────────────────────
    # Source: X API pay-per-use pricing (Feb 2026, Apr 2026 update).
    # New developers default to pay-per-use: $0.005/post read,
    # $0.001/owned-resource read, $0.015/standard write, $0.20/write
    # containing a URL. We bill reads here; writes (we don't do any)
    # would need their own sub_kind.
    "x_api": {
        "search_per_post": {"per_unit_usd": 0.005},
        "lookup_per_call": {"per_unit_usd": 0.005},
        "owned_read": {"per_unit_usd": 0.001},
        "*": {"per_unit_usd": 0.005},
    },

    # ── Vetric — contracted private rate ──────────────────────────────
    # TODO: confirm from Vetric contract. Public pricing not available
    # — placeholder until we get a copy of the invoice.
    "vetric": {
        "*": {"per_call_usd": 0.0005},
    },

    # ── Google Cloud infra ────────────────────────────────────────────
    "bq": {"per_tb_processed_usd": 5.0},
    "gcs": {"per_gb_stored_usd": 0.020, "per_gb_egress_usd": 0.12},
}


# ---------------------------------------------------------------------------
# Google Search Grounding helper
# ---------------------------------------------------------------------------


def _gemini_family(model: str | None) -> str:
    """Map a Gemini model name to the family used for grounding billing.

    Returns ``"gemini-3"``, ``"gemini-2.5"``, or ``"*"`` (unknown).
    """
    if not model:
        return "*"
    m = model.lower()
    if m.startswith("gemini-3"):
        return "gemini-3"
    if m.startswith("gemini-2.5"):
        return "gemini-2.5"
    return "*"


def compute_grounding_cost_micros(
    model: str | None,
    *,
    queries_executed: int = 0,
    prompts_grounded: int = 0,
) -> int | None:
    """Compute the Google-Search grounding cost for one model invocation.

    Args:
        model: Gemini model name (e.g. ``"gemini-3-flash-preview"``).
        queries_executed: number of search queries the model actually ran,
            as reported by ``grounding_metadata.web_search_queries``. Used
            for Gemini 3 family billing.
        prompts_grounded: 1 if this invocation triggered grounding at all
            (used for Gemini 2.5 family billing), else 0.

    Returns:
        Cost in USD-micros, or ``None`` if neither dimension applies or
        the family is unknown without a fallback rate.

    Note: free-tier allowances (5K/month for Gemini 3, 1.5K/day for 2.5)
    are NOT subtracted here — the rate table represents the marginal
    price per unit so per-row attribution stays clean. Aggregate the
    monthly free tier off the totals in BQ if you want a "net of free"
    view.
    """
    family = _gemini_family(model)
    rate = COST_RATES["google_search"].get(family) or COST_RATES["google_search"].get("*")
    if not rate:
        return None

    if "per_query_usd" in rate and queries_executed > 0:
        return _usd_to_micros(queries_executed * rate["per_query_usd"])
    if "per_prompt_usd" in rate and prompts_grounded > 0:
        return _usd_to_micros(prompts_grounded * rate["per_prompt_usd"])
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_USD_TO_MICROS = 1_000_000


def _usd_to_micros(usd: float) -> int:
    """Convert dollars to integer micros, rounding to nearest."""
    return int(round(usd * _USD_TO_MICROS))


def _get_or_fallback(table: dict, key: str | None) -> tuple[Any, bool]:
    """Look up ``key`` in ``table`` falling back to ``"*"``. Second tuple
    element is True iff the fallback was used (caller may log a warning).
    """
    if key and key in table:
        return table[key], False
    if "*" in table:
        return table["*"], True
    return None, True


def compute_cost_micros(
    provider: str,
    *,
    model: str | None = None,
    sub_kind: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_tokens: int = 0,
    units: int = 0,
    unit_kind: str | None = None,
    provider_reported_cost_usd: float | None = None,
    bytes_processed: int = 0,
) -> int | None:
    """Compute cost-micros for one external call.

    Args:
        provider: rate-table key ("gemini", "apify", ...).
        model: LLM model id, for gemini.
        sub_kind: optional sub-key for providers that price by endpoint /
            dataset / call type (e.g. x_api "search_per_post", brightdata
            dataset id).
        input_tokens / output_tokens / cached_tokens: LLM token counts.
        units: non-LLM volume (records, calls, posts).
        unit_kind: descriptor for ``units`` (free-text label, stored
            alongside).
        provider_reported_cost_usd: for providers tagged
            :data:`PROVIDER_REPORTED` (currently Apify), pass the exact
            cost the provider returned. Other arguments are ignored.
        bytes_processed: for BQ dry-run cost calculation.

    Returns:
        Integer USD-micros, or ``None`` if the provider is unknown.
        Returning ``None`` lets the caller still log the event with a NULL
        ``cost_micros`` rather than dropping it on the floor.
    """
    rate = COST_RATES.get(provider)
    if rate is None:
        return None

    if rate == PROVIDER_REPORTED:
        if provider_reported_cost_usd is None:
            return None
        return _usd_to_micros(provider_reported_cost_usd)

    if provider == "gemini":
        per_model, _ = _get_or_fallback(rate, model)
        if not per_model:
            return None
        cost_usd = (
            (input_tokens - cached_tokens) * per_model["input_per_mtok"] / 1_000_000
            + cached_tokens * per_model["cached_per_mtok"] / 1_000_000
            + output_tokens * per_model["output_per_mtok"] / 1_000_000
        )
        return _usd_to_micros(max(cost_usd, 0.0))

    if provider == "brightdata":
        per_ds, _ = _get_or_fallback(rate, sub_kind)
        if not per_ds:
            return None
        return _usd_to_micros(units * per_ds["per_record_usd"])

    if provider == "x_api":
        per_ep, _ = _get_or_fallback(rate, sub_kind)
        if not per_ep:
            return None
        return _usd_to_micros(units * per_ep["per_unit_usd"])

    if provider == "vetric":
        per_call, _ = _get_or_fallback(rate, sub_kind)
        if not per_call:
            return None
        return _usd_to_micros(units * per_call["per_call_usd"])

    if provider == "bq":
        per_tb = rate.get("per_tb_processed_usd", 0.0)
        return _usd_to_micros(bytes_processed / (1024 ** 4) * per_tb)

    if provider == "gcs":
        # Caller can pass `units=gigabytes` + `unit_kind` of "stored" or "egress".
        if unit_kind == "egress":
            return _usd_to_micros(units * rate["per_gb_egress_usd"])
        if unit_kind == "stored":
            return _usd_to_micros(units * rate["per_gb_stored_usd"])
        return None

    return None
