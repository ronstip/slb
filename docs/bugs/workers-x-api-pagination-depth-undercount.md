# workers — X API pagination depth under-provisioned (context_annotations cap)

## Symptom
Collection requesting 1000 posts across 3 keywords on twitter returned only ~265
(raw 300 − 35 in-memory dupes). Repro collection: `2df01110-b0f4-466e-aff8-8c6ec5c6c5e0`
(World Cup keywords, 7-day window). Firestore `run_log.collection.platforms.twitter`
showed `posts: 300, batches: 3` — exactly one page of 100 per keyword.

## Repro
Request n_posts=1000, 3 keywords, twitter, any wide time window with plenty of
matching tweets. Each keyword stops after a single page (~100), never paginating.

## Root cause
`max_calls` (pagination depth) was computed against `self._max_results` (500), but
`context_annotations` in `DEFAULT_TWEET_FIELDS` clamps each page to 100 *later*, inside
`_search_recent`. So `max_calls = ceil(334 / 500) = 1` while each page actually yields
only 100 → hard cap of ~100 posts per keyword whenever the per-keyword budget ≤ 500.
The 500-cap and the 100-cap were out of sync.

## Fix
Introduced `_CONTEXT_ANNOTATIONS_PAGE_CAP = 100` and a single `self._effective_page_size`
(in `__init__`) that both the request `max_results` and the `max_calls` math agree on.
`max_calls` now = `ceil(334 / 100) = 4` → ~334/keyword → ~1000 total.

- File: `workers/collection/adapters/x_api.py`
- Regression test: `workers/collection/adapters/test_x_api_adapter.py::test_max_calls_accounts_for_context_annotations_page_cap`
- Fix commit: (uncommitted, branch `dev`)

## Related
See memory `project_x_api_max_results.md` — same context_annotations gotcha, previously
known only to cap page *width*; here it silently capped pagination *depth*.
