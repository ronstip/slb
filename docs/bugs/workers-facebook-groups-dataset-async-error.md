# workers — Facebook channel (group) collection returns 0 posts (BrightData-side error)

## Repro
1. Agent → Settings → Data Sources → Facebook source.
2. Add a public group URL (tried `groups/2207096979555114` and `groups/dogspotting`),
   save, click Refresh/Play.
3. Collection runs but stores 0 posts.

## Root cause — PROVIDER SIDE, not ours
The BrightData facebook groups dataset (`gd_lz11l67o2cb3r0lkj3`) returns a single
error record for every group URL:

```
{"error": "Crawler error: async code is not allowed in sync functions",
 "error_code": "assert_no_async"}
```

This is internal to BrightData's actor for that dataset. Our invocation is correct:
the dataset reports `Supported types: ['url_collection']` (i.e. the `scrape_type="bare"`
url-input mode we already use); `discover_new` is explicitly rejected. So there is no
input shape on our side that avoids the error — the dataset itself is faulting.

## Status / next steps
- NOT fixed in code — nothing to fix on our side until BrightData resolves the dataset
  or we migrate to a different FB-group dataset/actor.
- The keyword (marketplace) FB path and all other platforms' channel collection
  (twitter/instagram/tiktok/youtube/reddit) are verified working.
- Options to pursue: open a BrightData support ticket referencing `assert_no_async`
  on `gd_lz11l67o2cb3r0lkj3`, or evaluate an Apify facebook group/page actor as the
  channel provider for facebook (would need a routing change in
  `config/collection_routing.py` + a parser).

## Resolution — migrated FB channel collection off BrightData to Apify
Instead of waiting on BrightData, FB channel collection was moved to the Apify
`apify/facebook-posts-scraper` page-feed actor (the same way IG channel uses
`apify/instagram-scraper` rather than the hashtag actor). Changes:

- `config/collection_routing.py`: `facebook` channel → `apify` (was `brightdata`).
- `config/settings.py`: new `apify_actor_facebook_page = "apify/facebook-posts-scraper"`
  (keyword FB still uses `apify_actor_facebook = scrapeforge/facebook-search-posts`).
- `workers/collection/adapters/apify.py`: `_collect_facebook` now branches on
  `channel_urls` → `_collect_facebook_channels` (startUrls = page URLs,
  `onlyPostsNewerThan` date floor, `resultsLimit`, `scrape_kind="channel"`).
  Bare handles normalized to page URLs via `_normalize_fb_page_url`.
- `workers/collection/adapters/apify_parsers.py`: new
  `parse_apify_facebook_page_post` / `parse_apify_facebook_page_channel`,
  registered for `("facebook", "apify/facebook-posts-scraper")`.
- `config/cost_rates.py`: FB channel rate cell moved brightdata→apify (Apify is
  PROVIDER_REPORTED; cell is estimate-fallback only).
- Precise date window still enforced downstream by the pipeline's
  `partition_by_time_range` gate (and the adapter's parse-time gate).
- Deploy parity: `APIFY_ACTOR_FACEBOOK_PAGE` added to `deploy_prod.sh`,
  `.github/workflows/deploy.yml`, `.env.example`.

Tests: `test_apify_adapter.py::test_collect_facebook_channel_mode_uses_page_actor`
(+ keyword-mode regression guard), `test_apify_parsers.py::test_facebook_page_*`,
routing tests updated (`test_channel_routing.py`, `api/tests/test_collection_channel.py`).
The old BrightData `_collect_facebook` group path is left in place but is now
unreachable for channel mode (routing no longer sends FB channels there).

## Fix commit
Uncommitted on branch `dev` (alongside the channel-collection work).
