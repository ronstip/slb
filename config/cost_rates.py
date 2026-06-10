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
# Seed scraper rate matrices (USD per post / record / read).
# ---------------------------------------------------------------------------
#
# These are the DEFAULT per-(provider, platform) rates the editor shows and
# `compute_cost_micros` / `get_scraper_rate` use. Admin edits saved to Firestore
# (`app_config/pricing`) deep-merge OVER these, so a single touched cell wins
# without wiping the rest. Only the (provider, platform) pairs we ACTUALLY use
# today are seeded; unused pairs are left absent so they render blank in the
# editor (fill them when we wire that provider/platform).
#
# Which provider serves which platform (see workers/collection/wrapper.py
# provider order + DEFAULT_VENDOR_* env):
#   posts:    instagram→apify · facebook/reddit/youtube→brightdata ·
#             tiktok→apify · twitter→x_api
#   comments: instagram/tiktok/youtube→apify · twitter→x_api
#             (facebook/reddit comments are not wired)
# Vetric is NOT in use - intentionally omitted from the seeds + the editor
# matrix. Its legacy COST_RATES["vetric"] entry is kept only so a stray call
# wouldn't crash; re-add it here + to _SCRAPER_PROVIDERS if we adopt it.
#
# IMPORTANT: only platform-specific cells are seeded (NOT "*") so the legacy
# sub_kind paths (e.g. x_api owned_read) still apply when no platform is given.
#
# Apify is PROVIDER_REPORTED - the exact run cost (`usageTotalUsd`) is always
# used first; the Apify cells below are the ESTIMATE fallback for runs that
# return no cost. BrightData / X_api / Vetric are rate-table priced, so their
# cells are AUTHORITATIVE.
#
# Sources (verified 2026-06; per-result actor prices ÷ 1000):
#   x_api search read $0.005/post            (docs.x.com pay-per-use, Feb 2026)
#   brightdata dataset marketplace $2.5/1k   (brightdata.com/pricing/datasets)
#   apify/instagram-scraper $1.50/1k posts   (apify.com/apify/instagram-scraper)
#   apify/facebook-posts-scraper $2.00/1k    (apify.com actor page)
#   apidojo/tiktok-scraper-api $0.30/1k      (apify.com/apidojo/tiktok-scraper-api)
#   apify/instagram-comment-scraper $2.30/1k (apify.com actor page)
#   clockworks/tiktok-comments-scraper $5/1k (apify.com/clockworks/tiktok-comments-scraper)
#   streamers/youtube-comments-scraper $0.50/1k (apify.com/streamers/youtube-comments-scraper)
#   vetric: PRIVATE CONTRACT - placeholder; confirm from invoice.
DEFAULT_SCRAPER_RATES: dict[str, dict[str, float]] = {
    # Estimate fallback only (provider-reported is authoritative).
    "apify": {"instagram": 0.0015, "facebook": 0.0020, "tiktok": 0.0003},
    # Authoritative - $0.0025/record across the social datasets we pull.
    "brightdata": {"facebook": 0.0025, "reddit": 0.0025, "youtube": 0.0025},
    # Authoritative - $0.005 per post (search) read.
    "x_api": {"twitter": 0.005},
    # Authoritative - HikerAPI bills per REQUEST (each request returns many
    # reels). Cost basis is requests, NOT records - the adapter passes
    # units=requests_made / unit_kind="requests". IG keyword surface only.
    # Pricing is TIERED by prepaid balance ($0.02 testing → $0.0006 enterprise
    # floor, hikerapi.com/pricing). $0.02 MEASURED on our account 2026-06-10
    # via GET /sys/balance ($1.16 balance ÷ 54 requests remaining ≈ $0.0215);
    # lower this via the admin Finance matrix when a top-up unlocks a cheaper
    # tier (re-derive: balance amount ÷ requests from /sys/balance).
    "hikerapi": {"instagram": 0.02},
}

DEFAULT_SCRAPER_COMMENT_RATES: dict[str, dict[str, float]] = {
    # Estimate fallback only (Apify comment actors are provider-reported).
    "apify": {"instagram": 0.0023, "tiktok": 0.0050, "youtube": 0.0005},
    # Authoritative - reply reads are billed identically to post reads.
    "x_api": {"twitter": 0.005},
    # brightdata / vetric comments are not wired → intentionally absent.
}

# Per-(provider, platform) CHANNEL (profile / page / subreddit) scrape rate
# matrix. Channel collection hits a DIFFERENT API/actor/dataset than keyword
# search, often at a different price - so it gets its own dimension (same shape
# as the comments matrix; unset cells fall through to the POSTS rate at lookup,
# see `get_scraper_rate`).
#
# Channel-mode routing (config/collection_routing.py): instagram/tiktok/facebook
# → apify, youtube/reddit → brightdata, twitter → x_api.
#   apify   → PROVIDER_REPORTED: these are ESTIMATE-fallback only; live cost is
#             the exact run cost regardless of actor.
#   brightdata (youtube/profiles, facebook groups, reddit subreddit) + x_api
#             (twitter timeline/from: search) → rate-table priced, AUTHORITATIVE.
# PLACEHOLDER values - confirm from provider invoices (file convention).
DEFAULT_SCRAPER_CHANNEL_RATES: dict[str, dict[str, float]] = {
    "apify": {
        "instagram": 0.0020,  # apify/instagram-scraper profile mode
        "tiktok": 0.0040,     # clockworks/tiktok-scraper (profiles)
        "facebook": 0.0020,   # apify/facebook-posts-scraper page feed
    },
    "brightdata": {
        "youtube": 0.0025,    # youtube/profiles dataset
        "reddit": 0.0025,     # reddit subreddit posts dataset
    },
    "x_api": {"twitter": 0.005},  # user_timeline / from: search read
}

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

    # ── HikerAPI - Instagram private-API; per-REQUEST price ────────────
    # Rate-table priced (AUTHORITATIVE): the provider returns no cost, so we
    # bill requests_made × per_request_usd. The per-(provider, platform) matrix
    # cell (scraper_rates_per_platform["hikerapi"]) wins over this "*" entry
    # when set; this is the fallback. units=requests, NOT records.
    # TIERED by prepaid balance; $0.02 measured on our account 2026-06-10 via
    # /sys/balance (the advertised $0.0006 is the enterprise floor) - keep in
    # sync with the matrix seed above.
    "hikerapi": {
        "*": {"per_request_usd": 0.02},
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


def _parse_scraper_matrix(raw: Any) -> dict[str, dict[str, float]]:
    """Normalize a ``{provider: {platform_or_*: usd}}`` matrix from a pricing
    doc: coerce values to non-negative floats, drop anything malformed, and
    omit providers that end up with no valid cells. Shared by the posts and
    comments scraper matrices.
    """
    out: dict[str, dict[str, float]] = {}
    if not isinstance(raw, dict):
        return out
    for prov, by_plat in raw.items():
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
            out[str(prov)] = cells
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
    # Seed defaults first, then let saved (Firestore) cells win cell-by-cell.
    scraper_matrix = _deep_merge(
        DEFAULT_SCRAPER_RATES, _parse_scraper_matrix(doc.get("scraper_rates_per_platform") or {}),
    )

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

    # Per-(provider, platform) COMMENTS rate matrix - same shape as the posts
    # matrix above but priced separately because comment scrapes hit the same
    # providers at a different rate. A cell that's unset here falls through to
    # the corresponding POSTS rate at lookup time (see `get_scraper_rate`), so
    # an admin only fills in cells where comments actually cost something
    # different. No legacy folds - this dimension is new.
    comment_matrix = _deep_merge(
        DEFAULT_SCRAPER_COMMENT_RATES,
        _parse_scraper_matrix(doc.get("scraper_comment_rates_per_platform") or {}),
    )

    # Per-(provider, platform) CHANNEL scrape rate matrix - same shape/fallthrough
    # as comments (unset cell → posts rate). New dimension, no legacy folds.
    channel_matrix = _deep_merge(
        DEFAULT_SCRAPER_CHANNEL_RATES,
        _parse_scraper_matrix(doc.get("scraper_channel_rates_per_platform") or {}),
    )

    cache = {
        "rates": _deep_merge(COST_RATES, doc.get("rate_overrides") or {}),
        "margin_multiplier": margin,
        "apify_assumed_per_post_usd": apify_pp,
        "scraper_rates_per_platform": scraper_matrix,
        "scraper_comment_rates_per_platform": comment_matrix,
        "scraper_channel_rates_per_platform": channel_matrix,
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


def get_apify_assumed_per_post_usd(
    platform: str | None = None, kind: str = "posts",
) -> float:
    """Per-post crawl cost assumed for Apify in pre-flight estimates AND
    in the live `estimated_fallback` cost path when Apify returns no
    ``usageTotalUsd`` on a run.

    When ``platform`` is given we look up the per-platform override
    from the scraper matrix and fall through to the scalar wildcard
    rate if no platform-specific override is set. ``kind`` selects the
    posts vs comments matrix (comments fall back to the posts rate when
    unset - see :func:`get_scraper_rate`).
    """
    rate = get_scraper_rate("apify", platform, kind)
    if rate is not None:
        return rate
    return _refresh_pricing()["apify_assumed_per_post_usd"]


def get_scraper_rates_per_platform() -> dict[str, dict[str, float]]:
    """Return a deep copy of the per-(provider, platform) scraper POSTS matrix.

    Shape: ``{provider: {platform_or_wildcard: usd}}``. Mutating the
    returned dict is safe (deep-copy); call ``invalidate_pricing_cache``
    if you persisted changes back to Firestore.
    """
    return copy.deepcopy(_refresh_pricing().get("scraper_rates_per_platform") or {})


def get_scraper_comment_rates_per_platform() -> dict[str, dict[str, float]]:
    """Return a deep copy of the per-(provider, platform) COMMENTS rate matrix.

    Same shape as :func:`get_scraper_rates_per_platform`. Cells that are
    unset here fall through to the posts rate at lookup time, so this dict
    only contains the cells an admin explicitly priced for comments.
    """
    return copy.deepcopy(_refresh_pricing().get("scraper_comment_rates_per_platform") or {})


def get_scraper_channel_rates_per_platform() -> dict[str, dict[str, float]]:
    """Return a deep copy of the per-(provider, platform) CHANNEL rate matrix.

    Same shape as :func:`get_scraper_rates_per_platform`. Cells unset here fall
    through to the posts rate at lookup time, so this dict only contains the
    cells an admin explicitly priced for channel collection.
    """
    return copy.deepcopy(_refresh_pricing().get("scraper_channel_rates_per_platform") or {})


def get_scraper_rate(
    provider: str, platform: str | None = None, kind: str = "posts",
) -> float | None:
    """Per-(provider, platform) effective $/unit for a scraper.

    ``kind`` is ``"posts"`` (default), ``"comments"`` or ``"channel"``. For
    ``"comments"``/``"channel"`` the lookup tries that matrix first and, when no
    cell is set for this (provider, platform), falls back to the **posts** rate -
    so an admin only fills cells where the price genuinely differs.

    Lookup order (per matrix):
      1. ``matrix[provider][platform]`` if both keys exist.
      2. ``matrix[provider]["*"]`` if the wildcard is set.
      3. (comments only) the posts rate for the same (provider, platform).
      4. ``None`` (caller falls back to the legacy COST_RATES entries).

    Used by:
      - Apify's live ``estimated_fallback`` path when ``run.usageTotalUsd``
        is missing.
      - BrightData / X_api / Vetric cost computation in
        :func:`compute_cost_micros` (preferred over the legacy
        ``COST_RATES[provider]["*"]`` rate when a matrix cell is set).
    """
    cache = _refresh_pricing()
    if kind == "comments":
        matrix = cache.get("scraper_comment_rates_per_platform") or {}
        cells = matrix.get(provider) or {}
        if platform and platform in cells:
            return cells[platform]
        if "*" in cells:
            return cells["*"]
        # No comment-specific cell - inherit the posts rate.
        return get_scraper_rate(provider, platform, "posts")
    if kind == "channel":
        matrix = cache.get("scraper_channel_rates_per_platform") or {}
        cells = matrix.get(provider) or {}
        if platform and platform in cells:
            return cells[platform]
        if "*" in cells:
            return cells["*"]
        # No channel-specific cell - inherit the posts rate.
        return get_scraper_rate(provider, platform, "posts")
    matrix = cache.get("scraper_rates_per_platform") or {}
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
    kind: str = "posts",
) -> int | None:
    """Compute cost-micros for one external call.

    Args:
        provider: rate-table key ("gemini", "apify", ...).
        kind: scraper rate dimension - "posts" (default), "comments" or
            "channel". Selects the matching rate matrix for BrightData / X_api /
            Vetric (comments/channel inherit the posts rate when no cell is set).
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
        matrix_rate = get_scraper_rate("brightdata", platform, kind)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_ds, _ = _get_or_fallback(rate, sub_kind)
        if not per_ds:
            return None
        return _usd_to_micros(units * per_ds["per_record_usd"])

    if provider == "x_api":
        # Matrix override (typically only `x` platform set) wins over
        # endpoint-keyed legacy entries.
        matrix_rate = get_scraper_rate("x_api", platform, kind)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_ep, _ = _get_or_fallback(rate, sub_kind)
        if not per_ep:
            return None
        return _usd_to_micros(units * per_ep["per_unit_usd"])

    if provider == "vetric":
        matrix_rate = get_scraper_rate("vetric", platform, kind)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_call, _ = _get_or_fallback(rate, sub_kind)
        if not per_call:
            return None
        return _usd_to_micros(units * per_call["per_call_usd"])

    if provider == "hikerapi":
        # Flat per-REQUEST price: units = requests made (not records). Matrix
        # cell wins; falls back to the legacy per_request_usd entry.
        matrix_rate = get_scraper_rate("hikerapi", platform, kind)
        if matrix_rate is not None:
            return _usd_to_micros(units * matrix_rate)
        per_req, _ = _get_or_fallback(rate, sub_kind)
        if not per_req:
            return None
        return _usd_to_micros(units * per_req["per_request_usd"])

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
