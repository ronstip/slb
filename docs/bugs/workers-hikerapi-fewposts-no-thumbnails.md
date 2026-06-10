# HikerAPI IG collection: too few posts + broken thumbnails

**Area:** workers (HikerAPI Instagram adapter — new IG keyword provider)

## Symptoms
1. Asked for 100 posts, got only ~20 (engagement numbers correct — provider working).
2. No thumbnails/media in the feed — broken-image placeholder with a play overlay on every reel.

## Root causes (in discovery order; 1–2 were earlier wrong/partial diagnoses)
1. ~~Fixed 3-page pagination cap~~ — replaced with request-driven pagination. Helped marginally; NOT the real cause.
2. **Video URL placed first in `media_urls`.** The feed renders `media_refs[0]` as the poster image; the parser appended the `.mp4` before the image → broken thumbnails. Fixed: image first.
3. **THE REAL VOLUME BUG: the reels SERP does not paginate at all.** `fbsearch_reels_v2` returns the same `reels_max_id` cursor on every page and re-serves (a shuffle of) the same module — verified in worker logs (`logs/runs/20260610T174551Z_38e37f18.log`: identical cursor on pages 2–3) and in the pilot dumps (all 16 pages of `pilot_hiker_reels_worldcup_20260609T214341Z_raw.json` carry the same cursor). Echoing `rank_token` back doesn't fix it (probed live). One keyword tops out at ~20–45 unique reels, period. The pilot's "85 unique over 5 pages" was server-side shuffle luck, not pagination.
4. **Time-gated pages counted as saturation.** Pages full of new-but-out-of-window posts incremented the same empty-streak counter, killing collection after 2 pages on narrow windows.
5. **No cross-keyword pooling.** `n_posts` is divided across keywords up front (`api/services/collection_service.py` `max_posts_per_keyword`); a dry keyword starved the total with no backfill.
6. **String `taken_at`.** The v1 hashtag chunk endpoints return `taken_at` as a STRING → `datetime.fromtimestamp` TypeError killed the whole keyword (found live).
7. **Account errors looked like empty SERPs.** HikerAPI signals `InsufficientFunds` in a 200 body (`{'state': False, 'error': 'Top up…'}`); the adapter silently collected 0.

## Fix (workers/collection/adapters/hikerapi.py — full rewrite of the collection loop)
- **Phased per-keyword collection** (`_KeywordStream`): `fbsearch_reels_v2` (viral SERP) → `hashtag_medias_top_chunk_v1` → `hashtag_medias_top_recent_chunk_v1` (the surface that actually fills a narrow time window) → `hashtag_medias_clips_chunk_v1`. The v1 hashtag chunks paginate properly (~150+ new/page, verified live).
- **Separate streak counters:** no-new-unique (saturation, 2 pages) vs new-but-all-gated (fruitless, 4 pages) → phase advance instead of giving up.
- **Global pooling:** after the per-keyword round, the unmet `n_posts` remainder is redistributed to keywords that can still produce; global cross-keyword pk-dedup; global engagement-trim to `n_posts`.
- **Parsers:** `_epoch_to_utc` accepts string epochs; adapter skips unparseable items instead of killing the keyword.
- **Account errors:** raise `RuntimeError` when nothing was collected (visible crawl error), keep partials otherwise. Raised AFTER cost logging.

## Prod follow-up (2026-06-11): 1000 asked → 37 stored
First prod run (collection d1c7865a) confirmed phases + chunk pagination work
(49 requests, correct cost), but the adapter's CLIENT-SIDE TIME GATE discarded
most fetched posts (World-Cup hashtags are dominated by 2022-era virals; only
37 of the raw media fell in the 7-day window). Discarding paid-for posts is
wrong AND inconsistent with the Apify/TikTok flow, where the PIPELINE
partitions: `partition_by_time_range` stores out-of-window posts (media
downloaded to GCS too) and only skips enrichment.

**Redesign:** adapter no longer time-gates. Every unique fetched post counts
toward the target and is returned; the pipeline stores all and enriches only
in-window ones. The final trim to `n_posts` is window-PRIORITIZED (in-window
first by engagement, then out-of-window extras) so old virals can't displace
fresh posts. Funnel moved off the bespoke platform_stats counters onto the
standard wrapper funnel (`hiker_requests/raw_media/duplicates/parse_failures/
valid_posts` in `_FUNNEL_KEYS`) so the admin Collections audit shows it; the
audit UI also now renders hiker funnels + an "Out of Time Window" row
(`posts_out_of_range`), and the discrepancy calc counts hiker raw media.

## Tests
`workers/collection/adapters/test_hikerapi_adapter.py` (phases, pooling, dedupe,
no-discard, window-prioritized trim, wrapper funnel, account errors),
`test_hikerapi_parsers.py` (string taken_at, image-first media).

## Note
Fixes apply to NEW collections only. See also `workers-hikerapi-cost-undercount.md`. Not yet committed (branch `dev`).
