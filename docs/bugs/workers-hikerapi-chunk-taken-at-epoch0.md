# workers — HikerAPI hashtag-chunk posts dropped via epoch-0 timestamp

## Symptom
Collection `61e87970-3efb-4b60-8886-1ef522dc2498` (IG, FIFA World Cup) collected
1000 posts but only **13** landed in `enriched_posts`. 929/1000 posts in BQ had
`posted_at = 1970-01-01` (epoch 0).

## Repro
1. Run an IG keyword collection via HikerAPI with a time window (e.g. last 7 days).
2. The reels-SERP phase (`fbsearch_reels_v2`) yields a handful of real-dated
   posts; the hashtag backfill phases (`hashtag_medias_*_chunk_v1`) yield the
   bulk — all dated 1970.
3. Pipeline time-window filter drops every 1970 post → only in-window posts
   enter the enrich DAG.

## Root cause
`fbsearch_reels_v2` returns `taken_at` as an **int** epoch. The
`hashtag_medias_*_chunk_v1` endpoints return `taken_at` as an **ISO-8601 string**
(`'2026-06-10T20:10:42Z'`) plus a separate int epoch in `taken_at_ts`.

`hikerapi_parsers._epoch_to_utc` only did `float(value)` — `float('2026-...Z')`
raises, so it **silently** returned epoch 0 ("epoch 0 on garbage"). The prior
test/comment wrongly assumed the chunk shape was a *string epoch* (`"1739000000"`).
Because the fallback was silent, `funnel.hiker_parse_failures` stayed 0 and the
collection reported `status: success`.

The 1000→13 funnel: 1000 collected → 71 real-dated (reels SERP) → 20 in time
window → 13 net new enriched (7 already enriched under another collection_id, so
idempotency-skipped on (post_id, agent_id, agent_version=11)).

## Fix
[hikerapi_parsers.py](../../workers/collection/adapters/hikerapi_parsers.py):
- Replaced `_epoch_to_utc` with `_to_utc` (handles int/float epoch, numeric
  string, and ISO-8601 string) + `_resolve_taken_at` which prefers the
  unambiguous int `taken_at_ts`, then `taken_at`.
- On unparseable timestamp, now logs a warning instead of silently masking to 1970.

## Regression test
[test_hikerapi_parsers.py](../../workers/collection/adapters/test_hikerapi_parsers.py):
`test_taken_at_iso_string_from_chunk_endpoints`,
`test_taken_at_ts_preferred_over_iso_string`.

Validated live against all 3 chunk/SERP endpoints: 0 epoch-0 posts post-fix
(60 chunk media that previously all parsed to 1970 now carry real dates).

## Fix commit
Branch `dev` (uncommitted at time of writing).
