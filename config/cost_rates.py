"""Single source of truth for external-call cost rates.

Edit this file when a provider bumps prices. Nothing else should hard-code
USD numbers. Costs are stored as USD-micros (USD * 1e6) so we never round
through floats; ``compute_cost_micros`` does the conversion.

Numbers are PLACEHOLDERS until confirmed against the latest invoice from
each provider. Update the corresponding ``# TODO: confirm from <provider>
invoice`` line when you do.
"""

from __future__ import annotations

import copy
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# A sentinel returned in place of a rate table when the provider reports the
# exact cost on the call itself (e.g. Apify's `run.usage.cost`).
PROVIDER_REPORTED = "use_provider_reported"

# Estimation-only / billing defaults that an admin can override at runtime
# (see the pricing-override layer below). These are the seed values.
DEFAULT_MARGIN_MULTIPLIER = 1.0          # profit factor; 1.0 = bill exact cost
DEFAULT_APIFY_ASSUMED_PER_POST_USD = 0.004  # apify is PROVIDER_REPORTED; assumed for pre-flight estimate

# ---------------------------------------------------------------------------
# Rate table
# ---------------------------------------------------------------------------
#
# Shape:
#   gemini:       per-model {input_per_mtok, output_per_mtok, cached_per_mtok}
#   apify:        PROVIDER_REPORTED sentinel - capture run.usage.cost directly
#   brightdata:   per-dataset {per_record_usd}
#   x_api:        per-endpoint {per_unit_usd}
#   vetric:       {per_call_usd}
#   bq:           {per_tb_processed_usd}
#   gcs:          {per_gb_stored_usd, per_gb_egress_usd}
#
# Use "*" as a fallback key when an unrecognised model/dataset id is seen -
# avoids dropping cost on the floor while still flagging drift in logs.

COST_RATES: dict[str, Any] = {
    # ── Gemini API - token-priced models ──────────────────────────────
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
        # Fallback - bills like 3-flash (the codebase default). If we
        # see logs at this rate that means we routed a new/unknown model
        # name and the rate is approximate - update this table.
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

    # ── Apify - provider-reported exact cost on the run object ────────
    "apify": PROVIDER_REPORTED,

    # ── BrightData - Web Scraper API + Datasets ───────────────────────
    # Source: https://brightdata.com/pricing/datasets - IG & TikTok
    # datasets at $250 / 100K records = $0.0025/record. The Web Scraper
    # API's pay-per-success price varies by scraper; the dataset
    # marketplace baseline is the closest public anchor we have.
    "brightdata": {
        "*": {"per_record_usd": 0.0025},
    },

    # ── X (Twitter) API - pay-per-use default tier ────────────────────
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

    # ── Vetric - contracted private rate ──────────────────────────────
    # TODO: confirm from Vetric contract. Public pricing not available
    # - placeholder until we get a copy of the invoice.
    "vetric": {
        "*": {"per_call_usd": 0.0005},
    },

    # ── Google Cloud infra ────────────────────────────────────────────
    "bq": {"per_tb_processed_usd": 5.0},
    "gcs": {"per_gb_stored_usd": 0.020, "per_gb_egress_usd": 0.12},
}


# ---------------------------------------------------------------------------
# Runtime pricing overrides (§E admin-editable rates + profit margin)
# ---------------------------------------------------------------------------
#
# The table above is the SEED/default. Admins can override individual rate
# fields and the global profit margin from the Finance admin page; those
# overrides live in Firestore (`app_config/pricing`) and are deep-merged over
# the seed here. `compute_cost_micros` / `compute_grounding_cost_micros` read
# the merged ("effective") table, so every existing caller - api AND workers -
# automatically respects admin edits with no call-site change.
#
# Read is cached per-process for a short TTL so hot paths don't hit Firestore
# every call. The Firestore read is lazy (`from api.deps import get_fs`),
# mirroring `cost_meter` so it works inside worker processes too.

_PRICING_TTL = 60.0
_pricing_cache: dict[str, Any] | None = None
_pricing_cache_expiry: float = 0.0


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge ``override`` into a deep copy of ``base``.

    Dicts merge key-by-key; any non-dict value (or dict-over-non-dict) replaces.
    """
    out = copy.deepcopy(base)
    for key, val in (override or {}).items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


def _load_pricing_doc() -> dict:
    """Read `app_config/pricing` from Firestore; {} on any failure (fail to seed)."""
    try:
        from api.deps import get_fs

        return get_fs().get_pricing_config() or {}
    except Exception:
        logger.debug("cost_rates: pricing doc read failed - using seed defaults", exc_info=True)
        return {}


def _refresh_pricing() -> dict[str, Any]:
    """Return the cached {rates, margin_multiplier, apify_assumed_per_post_usd}."""
    global _pricing_cache, _pricing_cache_expiry
    now = time.monotonic()
    cache = _pricing_cache
    if cache is not None and _pricing_cache_expiry > now:
        return cache

    doc = _load_pricing_doc()

    try:
        margin = float(doc.get("margin_multiplier", DEFAULT_MARGIN_MULTIPLIER))
    except (TypeError, ValueError):
        margin = DEFAULT_MARGIN_MULTIPLIER
    if margin <= 0:
        margin = DEFAULT_MARGIN_MULTIPLIER

    try:
        apify_pp = float(doc.get("apify_assumed_per_post_usd", DEFAULT_APIFY_ASSUMED_PER_POST_USD))
    except (TypeError, ValueError):
        apify_pp = DEFAULT_APIFY_ASSUMED_PER_POST_USD
    if apify_pp < 0:
        apify_pp = DEFAULT_APIFY_ASSUMED_PER_POST_USD

    # Per-(provider, platform) scraper rate matrix. Each cell is the
    # effective $/post (or $/record / $/call) for that (provider, platform)
    # pair, used as the cost source when the provider doesn't report an
    # exact number on the call (Apify estimated_fallback path) AND as the
    # authoritative price for the providers that do rely on rate-table
    # lookup (BrightData / X_api / Vetric).
    #
    # Shape: ``{provider: {platform: usd, "*": usd_wildcard}}``. A
    # missing platform falls through to "*", and a missing "*" falls
    # through to the legacy single-key rate table entries below.
    #
    # Back-compat: the prior `apify_assumed_per_post_usd_by_platform` and
    # the scalar `apify_assumed_per_post_usd` are folded into
    # ``scraper_rates_per_platform["apify"]`` (the scalar becomes the "*"
    # cell) so existing pricing-config docs still work without rewrite.
    scraper_matrix_raw = doc.get("scraper_rates_per_platform") or {}
    scraper_matrix: dict[str, dict[str, float]] = {}
    if isinstance(scraper_matrix_raw, dict):
        for prov, by_plat in scraper_matrix_raw.items():
            if not isinstance(by_plat, dict):
                continue
            cells: dict[str, float] = {}
            for plat, val in by_plat.items():
                try:
                    v = float(val)
                except (TypeError, ValueError):
                    continue
                if v >= 0:
                    cells[str(plat)] = v
            if cells:
                scraper_matrix[str(prov)] = cells

    # Fold the legacy Apify per-platform dict into the matrix so a doc
    # written by an older client still drives Apify behaviour. Cells set
    # in the new structure win (most-recent edit).
    legacy_apify_by_platform = doc.get("apify_assumed_per_post_usd_by_platform") or {}
    if isinstance(legacy_apify_by_platform, dict):
        merged_apify = dict(scraper_matrix.get("apify") or {})
        for plat, val in legacy_apify_by_platform.items():
            if plat in merged_apify:
                continue
            try:
                v = float(val)
            except (TypeError, ValueError):
                continue
            if v >= 0:
                merged_apify[str(plat)] = v
        if merged_apify:
            scraper_matrix["apify"] = merged_apify

    # Fold the scalar Apify wildcard into the matrix as `apify["*"]` if
    # the matrix doesn't already pin one - keeps the historical behaviour
    # of `get_apify_assumed_per_post_usd()` intact.
    apify_cells = scraper_matrix.setdefault("apify", {})
    apify_cells.setdefault("*", apify_pp)

    cache = {
        "rates": _deep_merge(COST_RATES, doc.get("rate_overrides") or {}),
        "margin_multiplier": margin,
        "apify_assumed_per_post_usd": apify_pp,
        "scraper_rates_per_platform": scraper_matrix,
    }
    _pricing_cache = cache
    _pricing_cache_expiry = now + _PRICING_TTL
    return cache


def get_active_rates() -> dict[str, Any]:
    """Effective rate table: admin overrides deep-merged over the seed."""
    return _refresh_pricing()["rates"]


def get_margin_multiplier() -> float:
    """Global profit factor; user wallet is debited cost × this. Default 1.0."""
    return _refresh_pricing()["margin_multiplier"]


def get_apify_assumed_per_post_usd(platform: str | None = None) -> float:
    """Per-post crawl cost assumed for Apify in pre-flight estimates AND
    in the live `estimated_fallback` cost path when Apify returns no
    ``usageTotalUsd`` on a run.

    When ``platform`` is given we look up the per-platform override
    from the scraper matrix and fall through to the scalar wildcard
    rate if no platform-specific override is set.
    """
    rate = get_scraper_rate("apify", platform)
    if rate is not None:
        return rate
    return _refresh_pricing()["apify_assumed_per_post_usd"]


def get_scraper_rates_per_platform() -> dict[str, dict[str, float]]:
    """Return a deep copy of the per-(provider, platform) scraper matrix.

    Shape: ``{provider: {platform_or_wildcard: usd}}``. Mutating the
    returned dict is safe (deep-copy); call ``invalidate_pricing_cache``
    if you persisted changes back to Firestore.
    """
    return copy.deepcopy(_refresh_pricing().get("scraper_rates_per_platform") or {})


def get_scraper_rate(provider: str, platform: str | None = None) -> float | None:
    """Per-(provider, platform) effective $/post for a scraper.

    Lookup order:
      1. ``scraper_rates_per_platform[provider][platform]`` if both keys exist.
      2. ``scraper_rates_per_platform[provider]["*"]`` if the wildcard is set.
      3. ``None`` (caller should fall back to the legacy COST_RATES entries).

    Used by:
      - Apify's live ``estimated_fallback`` path when ``run.usageTotalUsd``
        is missing.
      - BrightData / X_api / Vetric cost computation in
        :func:`compute_cost_micros` (preferred over the legacy
        ``COST_RATES[provider]["*"]`` rate when a matrix cell is set).
    """
    matrix = _refresh_pricing().get("scraper_rates_per_platform") or {}
    cells = matrix.get(provider) or {}
    if platform and platform in cells:
        return cells[platform]
    if "*" in cells:
        return cells["*"]
    return None


def invalidate_pricing_cache() -> None:
    """Drop the cached pricing (call right after an admin pricing edit)."""
    global _pricing_cache, _pricing_cache_expiry
    _pricing_cache = None
    _pricing_cache_expiry = 0.0


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
    are NOT subtracted here - the rate table represents the marginal
    price per unit so per-row attribution stays clean. Aggregate the
    monthly free tier off the totals in BQ if you want a "net of free"
    view.
    """
    family = _gemini_family(model)
    gs = get_active_rates()["google_search"]
    rate = gs.get(family) or gs.get("*")
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


# Legacy/external aliases → canonical rate-table key. Keeps `Post.crawl_provider`
# and the public `vendor_config.default` ("xapi") usable as cost-lookup keys.
_PROVIDER_ALIASES: dict[str, str] = {
    "xapi": "x_api",
}


def normalize_provider(provider: str | None) -> str | None:
    """Map external/legacy provider names to the canonical rate-table key."""
    if not provider:
        return provider
    return _PROVIDER_ALIASES.get(provider, provider)


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
    platform: str | None = None,
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
    provider = normalize_provider(provider) or provider
    rate = get_active_rates().get(provider)
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
        # Per-(platform) matrix wins over the legacy "*" entry when set -
        # lets the admin price IG vs TikTok vs FB records differently.
        matrix_rate = get_scraper_rate("brightdata", platform)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_ds, _ = _get_or_fallback(rate, sub_kind)
        if not per_ds:
            return None
        return _usd_to_micros(units * per_ds["per_record_usd"])

    if provider == "x_api":
        # Matrix override (typically only `x` platform set) wins over
        # endpoint-keyed legacy entries.
        matrix_rate = get_scraper_rate("x_api", platform)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_ep, _ = _get_or_fallback(rate, sub_kind)
        if not per_ep:
            return None
        return _usd_to_micros(units * per_ep["per_unit_usd"])

    if provider == "vetric":
        matrix_rate = get_scraper_rate("vetric", platform)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
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
