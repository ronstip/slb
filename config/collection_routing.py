"""Provider routing - single source of truth (keyword + channel mode).

Routing is split by collection intent:
  - KEYWORD collection -> `keyword_provider_for(platform)`.
  - CHANNEL collection (a source carries `channel_urls`) ->
    `channel_provider_for(platform)`, which for some platforms differs from
    the keyword default (facebook/tiktok/reddit move to Apify) because channel
    collection hits a different API/actor that supports a date window.

Both lookups are ADMIN-EDITABLE at runtime: the Firestore doc
`app_config/routing` deep-merges over the code seeds below, so the provider for
a (platform, intent) can change without a redeploy (e.g. flip Instagram keyword
between `hikerapi` and `apify`). Reads are cached per-process for a short TTL,
mirroring `config.cost_rates`.

Imported by BOTH:
  - `workers/collection/wrapper.py` - to pick the adapter.
  - `api/services/collection_service.py` - so the pre-flight cost estimate maps
    each portion to the SAME provider (and thus the same rate cell).

Vendor tokens match `wrapper._VENDOR_CLASS_MAP` keys
("xapi"/"apify"/"brightdata"/"vetric"/"hikerapi"/"mock"). The cost estimator
translates "xapi" -> "x_api" (its rate-key) the same way it does for
`vendor_config`.
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

# platform -> vendor token (see wrapper._VENDOR_CLASS_MAP). Each pair reuses an
# adapter+parser that already exists (no blind new actors); the date window is
# enforced for every platform by the pipeline's `partition_by_time_range` gate,
# with server-side date filters passed where the actor/dataset supports them.
CHANNEL_PROVIDER_BY_PLATFORM: dict[str, str] = {
    "twitter": "xapi",       # X API: from:{handle} search / user_timeline (server-side date)
    "instagram": "apify",    # apify/instagram-scraper profile (onlyPostsNewerThan)
    "tiktok": "apify",       # clockworks/tiktok-scraper profiles (oldestPostDateUnified)
    "youtube": "brightdata", # BD youtube/profiles dataset (start_date/end_date)
    "facebook": "apify",     # apify/facebook-posts-scraper page feed (onlyPostsNewerThan)
    "reddit": "brightdata",  # BD reddit subreddit posts (pipeline-gated date)
}

# platform -> vendor token for KEYWORD collection. Seeded EXPLICITLY for every
# platform (not left to "first-supporting" inference) so the admin routing
# editor shows a concrete provider per platform rather than "Auto". Each value
# equals what the first-supporting adapter order already resolves to today, so
# seeding is behaviour-preserving; the wrapper still falls back to
# first-supporting if a named vendor isn't initialized (e.g. HIKERAPI_API_KEY
# unset → IG keyword degrades to Apify).
#   instagram -> hikerapi: reels SERP reaches viral content the hashtag
#                          surfaces can't.
#   tiktok/facebook -> apify (scrapeforge FB search, apidojo TikTok).
#   twitter -> xapi · youtube/reddit -> brightdata.
KEYWORD_PROVIDER_BY_PLATFORM: dict[str, str] = {
    "instagram": "hikerapi",
    "tiktok": "apify",
    "twitter": "xapi",
    "facebook": "apify",
    "youtube": "brightdata",
    "reddit": "brightdata",
}

# Only X can scope a keyword search to a channel natively (`from:{handle} {kw}`).
# On every other platform keyword and channel are mutually exclusive per source
# (enforced in the Data Sources UI): a source is keyword-search OR channel
# collection, never both - the platform can't intersect them and a
# fetch-then-discard filter would burn cost and risk 0 results.
NATIVE_CHANNEL_KEYWORD_PLATFORMS: frozenset[str] = frozenset({"twitter"})


# ---------------------------------------------------------------------------
# Runtime routing overrides (admin-editable, Firestore-backed)
# ---------------------------------------------------------------------------
#
# `app_config/routing` shape:
#   {
#     "keyword_provider_by_platform": {platform: vendor_token, ...},
#     "channel_provider_by_platform": {platform: vendor_token, ...},
#   }
# Each map deep-merges over the seeds above (a single edited cell wins). Read
# lazily via `api.deps.get_fs` so it works inside worker processes too.

_ROUTING_TTL = 60.0
_routing_cache: dict | None = None
_routing_cache_expiry: float = 0.0


def _load_routing_doc() -> dict:
    """Read `app_config/routing` from Firestore; {} on any failure (use seeds)."""
    try:
        from api.deps import get_fs

        return get_fs().get_routing_config() or {}
    except Exception:
        logger.debug("collection_routing: routing doc read failed - using seeds", exc_info=True)
        return {}


def _routing_config() -> dict:
    """Effective routing maps: Firestore overrides merged over the code seeds."""
    global _routing_cache, _routing_cache_expiry
    now = time.monotonic()
    if _routing_cache is not None and _routing_cache_expiry > now:
        return _routing_cache

    doc = _load_routing_doc()

    def _merge(seed: dict, key: str) -> dict:
        out = dict(seed)
        override = doc.get(key)
        if isinstance(override, dict):
            for plat, vendor in override.items():
                if vendor:  # non-empty string sets/overrides; empty/None is ignored
                    out[str(plat)] = str(vendor)
        return out

    cache = {
        "keyword_provider_by_platform": _merge(KEYWORD_PROVIDER_BY_PLATFORM, "keyword_provider_by_platform"),
        "channel_provider_by_platform": _merge(CHANNEL_PROVIDER_BY_PLATFORM, "channel_provider_by_platform"),
    }
    _routing_cache = cache
    _routing_cache_expiry = now + _ROUTING_TTL
    return cache


def invalidate_routing_cache() -> None:
    """Drop the cached routing config (call right after an admin routing edit)."""
    global _routing_cache, _routing_cache_expiry
    _routing_cache = None
    _routing_cache_expiry = 0.0


def channel_provider_for(platform: str) -> str | None:
    """Vendor token to route `platform` to in channel mode, or None if unsupported."""
    return _routing_config()["channel_provider_by_platform"].get(platform)


def keyword_provider_for(platform: str) -> str | None:
    """Vendor token to route `platform` to in keyword mode.

    Precedence: admin routing override / seed -> env `default_vendor_<platform>`
    -> None (caller falls through to `vendor_config.default` / first-supporting).
    """
    vendor = _routing_config()["keyword_provider_by_platform"].get(platform)
    if vendor:
        return vendor
    # Low-priority env seed fallback (legacy DEFAULT_VENDOR_* env vars).
    try:
        from config.settings import get_settings

        env_default = getattr(get_settings(), f"default_vendor_{platform}", "") or ""
        return env_default or None
    except Exception:
        return None


def effective_routing_view() -> dict[str, dict[str, str | None]]:
    """Effective (post-override) keyword + channel provider per platform.

    Powers the admin routing editor's "current value" display. Covers every
    platform that appears in either seed.
    """
    platforms = sorted(set(KEYWORD_PROVIDER_BY_PLATFORM) | set(CHANNEL_PROVIDER_BY_PLATFORM))
    return {
        "keyword_provider_by_platform": {p: keyword_provider_for(p) for p in platforms},
        "channel_provider_by_platform": {p: channel_provider_for(p) for p in platforms},
    }
