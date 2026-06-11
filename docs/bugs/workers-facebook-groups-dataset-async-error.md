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

## Reopened 2026-06-11 — page actor returns NO-DATA for GROUP feeds
The Apify migration above only wired the **page** actor
(`apify/facebook-posts-scraper`), which scrapes pages/profiles ONLY. A user
collected a public group (`facebook.com/groups/1526461191971818`) → 0 posts +
Sentry `SCOLTO-BACKEND-H`: `[NO-DATA]: 1526461191971818` (the actor's own run
log, captured by Sentry — not our code). Group URLs were passed straight into
the page actor's `startUrls` via `_normalize_fb_page_url`, which doesn't
distinguish page from group.

### Resolution — dedicated groups actor, auto-routed by URL (seamless, no UI change)
- `config/settings.py`: new `apify_actor_facebook_group = "apify/facebook-groups-scraper"`.
- `workers/collection/adapters/apify.py`:
  - new `_is_fb_group_url(url)` (`/groups/` in normalized URL).
  - `_collect_facebook_channels` is now a dispatcher: normalize+dedup, then
    partition into page_urls / group_urls and fan out one run per bucket via the
    new shared `_run_fb_channel_urls(urls, config, actor_id, scrape_kind, label)`
    helper (pages→`channel`, groups→`group`; per-bucket `resultsLimit`). A source
    can mix both. Page and group actors share the same
    `startUrls`/`resultsLimit`/`onlyPostsNewerThan` input shape.
- `workers/collection/adapters/apify_parsers.py`: new
  `parse_apify_facebook_group_post` / `parse_apify_facebook_group_channel`
  (channel == the GROUP, not the member who posted: `channel_id`=groupId via
  `groupId`/URL fallback, `channel_handle`=groupTitle; poster → platform_metadata),
  registered for `("facebook", "apify/facebook-groups-scraper")`.
- Cost: no change — keyed by (provider, platform); apify+facebook cell covers
  groups and apify is PROVIDER_REPORTED (live run cost captured).
- Deploy parity: `APIFY_ACTOR_FACEBOOK_GROUP` added to `.env.example`,
  `scripts/deploy_prod.sh`, `.github/workflows/deploy.yml`.

UX: the channel field already reads "Page or group URL"; routing is automatic by
URL, so users just paste any FB URL. No frontend change.

Tests: `test_apify_adapter.py::{test_is_fb_group_url,
test_collect_facebook_group_mode_uses_group_actor,
test_collect_facebook_mixed_pages_and_groups_split_actors}` (+ page-mode
regression guard stays green); `test_apify_parsers.py::test_facebook_group_*`.

### Still to verify live
The groups actor's real output field names + whether it accepts
`onlyPostsNewerThan` — re-run the collection on `groups/1526461191971818`,
confirm posts > 0, and adjust the parser `_first()` fallbacks if the actor emits
different keys. Sentry `SCOLTO-BACKEND-H` to resolve once verified.

### Fix commit (groups)
Uncommitted on branch `dev`.
