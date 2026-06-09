"""Channel-mode provider routing - single source of truth.

When a collection carries `channel_urls` (collect from a specific account/page),
the platform is routed to the provider whose API/actor supports *channel* (profile
/ page / subreddit) collection WITH a date window, which differs from the default
keyword-mode routing for some platforms (facebook/tiktok/reddit move to Apify).

Imported by BOTH:
  - `workers/collection/wrapper.py` - to pick the channel-capable adapter.
  - `api/services/collection_service.py` - so the pre-flight cost estimate maps
    the channel portion to the SAME provider (and thus the same channel rate cell).

Vendor tokens match `wrapper._VENDOR_CLASS_MAP` keys ("xapi"/"apify"/"brightdata").
The cost estimator translates "xapi" -> "x_api" (its rate-key) the same way it
already does for `vendor_config`.
"""

from __future__ import annotations

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

# Only X can scope a keyword search to a channel natively (`from:{handle} {kw}`).
# On every other platform keyword and channel are mutually exclusive per source
# (enforced in the Data Sources UI): a source is keyword-search OR channel
# collection, never both - the platform can't intersect them and a
# fetch-then-discard filter would burn cost and risk 0 results.
NATIVE_CHANNEL_KEYWORD_PLATFORMS: frozenset[str] = frozenset({"twitter"})


def channel_provider_for(platform: str) -> str | None:
    """Vendor token to route `platform` to in channel mode, or None if unsupported."""
    return CHANNEL_PROVIDER_BY_PLATFORM.get(platform)
