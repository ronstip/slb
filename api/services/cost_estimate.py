"""Pre-flight cost estimate for a collection / autonomous agent run (§E).

`require_credit_for_run` uses this to refuse a run the prepaid wallet can't
cover, so a run never dies mid-way and wastes a user's credit. Numbers are
deliberately CONSERVATIVE (over-estimate) - the real returned post count and
enrichment token usage aren't known until the run executes, so we bill the
requested `n_posts` ceiling, assume per-post enrichment tokens, and multiply
the whole thing by a safety buffer.

All rates come from :mod:`config.cost_rates` - never hard-code USD here beyond
the estimation-only assumptions below.
"""

from __future__ import annotations

from config.cost_rates import (
    _usd_to_micros,
    compute_cost_micros,
    compute_grounding_cost_micros,
    get_active_rates,
    get_apify_assumed_per_post_usd,
    get_margin_multiplier,
    get_scraper_rate,
    normalize_provider,
)

# Estimation-only assumptions (not real telemetry - see module docstring).
RUN_COST_BUFFER = 1.2
ASSUMED_INPUT_TOKENS_PER_POST = 1_200
ASSUMED_OUTPUT_TOKENS_PER_POST = 300
COMMENTS_MULTIPLIER = 1.5  # include_comments fetches extra per-post reads
DEFAULT_PER_POST_USD = 0.005  # unknown/unspecified provider → conservative
# Rough number of grounded search queries an agent run fires if search is on
# but the caller doesn't give a count.
ASSUMED_SEARCH_QUERIES = 10


def _provider_per_post_usd(
    provider: str, platform: str | None = None, kind: str = "posts",
) -> float:
    """Conservative per-post crawl cost for a (provider, platform) pair.

    Reads the admin-editable per-(provider, platform) scraper matrix FIRST -
    the same `get_scraper_rate` source the live cost meter
    (`compute_cost_micros`) uses - so a matrix edit in the Finance "Rates &
    profit margin" editor moves both the estimate and actual billing in
    lockstep. Falls back to the legacy single COST_RATES entry only when no
    matrix cell (platform-specific or wildcard) is set.
    """
    p = normalize_provider((provider or "").lower()) or (provider or "").lower()

    # Matrix first (admin-editable, per-platform). `platform=None` still picks
    # up a wildcard "*" cell if the admin set one. None → no matrix cell → fall
    # through to the legacy rate below. `kind="channel"` consults the channel
    # matrix (which itself falls back to the posts rate when a cell is unset).
    matrix_rate = get_scraper_rate(p, platform, kind)
    if matrix_rate is not None:
        return matrix_rate

    rates = get_active_rates()
    if p == "brightdata":
        return rates["brightdata"]["*"]["per_record_usd"]
    if p in ("x_api", "x", "twitter"):
        return rates["x_api"]["*"]["per_unit_usd"]
    if p == "vetric":
        return rates["vetric"]["*"]["per_call_usd"]
    if p == "apify":
        return get_apify_assumed_per_post_usd(platform)
    return DEFAULT_PER_POST_USD


def estimate_run_cost_micros(
    *,
    n_posts: int,
    providers: list[str] | None = None,
    provider_platform_pairs: list[tuple[str | None, str | None]] | None = None,
    channel_mode: bool = False,
    include_comments: bool = False,
    enrichment_enabled: bool = True,
    gemini_model: str = "gemini-3-flash-preview",
    search_grounding: bool = False,
    n_search_queries: int | None = None,
) -> int:
    """Estimate the total USD-micros a run will cost.

    Args:
        n_posts: requested post ceiling (the cost lever).
        providers: provider rate keys actually used (brightdata/x_api/vetric/
            apify), platform-agnostic. When unknown/empty we bill the
            conservative default rate.
        provider_platform_pairs: explicit (provider, platform) pairs the run
            will hit. Preferred over ``providers`` because it lets the rate
            lookup consult the per-platform scraper matrix cell - so an admin
            edit to e.g. BrightData×YouTube moves this estimate. Falls back to
            ``providers`` (platform=None) when not given.
        channel_mode: when True the crawl is channel collection - bill at the
            CHANNEL rate cell for each (provider, platform) pair (falls back to
            the posts rate when unset). The pairs must already be the
            channel-mode providers (see config.collection_routing).
        include_comments: fetches extra per-post reads → multiplier.
        enrichment_enabled: bill assumed Gemini enrichment tokens per post.
        gemini_model: model used for enrichment (rate lookup).
        search_grounding: bill assumed Google-Search grounding.
        n_search_queries: explicit grounded-query count; defaults to a rough
            assumption when search is on.

    Returns:
        Integer USD-micros including the safety buffer. Never negative.
    """
    n_posts = max(int(n_posts or 0), 0)

    # 1) Crawl - bill the requested ceiling at the most expensive selected
    #    (provider, platform) per-post rate (conservative). Prefer the explicit
    #    (provider, platform) pairs so per-platform matrix cells are consulted;
    #    fall back to platform-agnostic provider keys, then the default rate.
    rate_kind = "channel" if channel_mode else "posts"
    if provider_platform_pairs:
        per_post = max(
            _provider_per_post_usd(prov, plat, rate_kind)
            for prov, plat in provider_platform_pairs
        )
    elif providers:
        per_post = max(_provider_per_post_usd(p, None, rate_kind) for p in providers)
    else:
        per_post = DEFAULT_PER_POST_USD
    crawl_usd = n_posts * per_post
    if include_comments:
        crawl_usd *= COMMENTS_MULTIPLIER
    total_micros = _usd_to_micros(crawl_usd)

    # 2) Enrichment - assumed Gemini tokens per post.
    if enrichment_enabled and n_posts > 0:
        enrich = compute_cost_micros(
            "gemini",
            model=gemini_model,
            input_tokens=n_posts * ASSUMED_INPUT_TOKENS_PER_POST,
            output_tokens=n_posts * ASSUMED_OUTPUT_TOKENS_PER_POST,
        )
        total_micros += enrich or 0

    # 3) Search grounding.
    if search_grounding:
        queries = n_search_queries if n_search_queries is not None else ASSUMED_SEARCH_QUERIES
        grounding = compute_grounding_cost_micros(
            gemini_model, queries_executed=queries, prompts_grounded=1,
        )
        total_micros += grounding or 0

    # Pre-flight gate compares this to the wallet, which is denominated in
    # BILLED dollars (provider cost × profit margin). Apply the margin here so
    # the gate refuses a run the user can't afford at the price WE charge, not
    # the raw provider cost. Buffer covers run-time over-estimate (§E).
    billed = total_micros * RUN_COST_BUFFER * get_margin_multiplier()
    return max(int(round(billed)), 0)
