# HikerAPI "top posts" phase hashtagized the keyword (lost multi-word/non-Latin queries)

## Symptom
Instagram keyword collections via HikerAPI under-yield (or return 0) for
multi-word / non-Latin keywords — e.g. Hebrew political names like
`"בנימין נתניהו"`, `"בחירות 2026"`. Other platforms in the same agent run
(twitter/facebook/tiktok) returned hundreds of posts; the Instagram split came
back near-empty.

## Root cause
`_KeywordStream` ran a "top posts" phase that called the **hashtag** endpoint
`hashtag_medias_top_chunk_v1(name=_hashtagize(keyword))`. `_hashtagize` strips
all `\W` and lowercases, so `"בנימין נתניהו"` → `"בנימיןנתניהו"` — a collapsed
single-token hashtag that mostly doesn't exist on IG. The top-posts endpoint is
hashtag-keyed (no spaces possible), so the keyword's real phrasing was lost.

HikerAPI's actual free-text top-posts surface is a *different* SDK method:
`fbsearch_topsearch_v2(query)` → `/v2/fbsearch/topsearch`, which accepts an
arbitrary query string (spaces/phrases intact) and paginates via
`media_grid.next_max_id`. Verified live: raw `"בנימין נתניהו"` returns media +
a working cursor.

## Fix
`workers/collection/adapters/hikerapi.py`: replaced phase `hashtag_top` with
`topsearch`, which calls `fbsearch_topsearch_v2(self.keyword, ...)` using the
**raw keyword** (no hashtagizing) and extracts the cursor from `media_grid`.
The `recent`/`clips` phases stay hashtag-keyed (those only exist as
`/v1/hashtag/medias/...` endpoints, which require a hashtag `name`). Phase 1
`reels_serp` was already raw-keyword.

## Budget split (20/50/30) + paid-post-discard bug
Same uncommitted change also reworked phase budgeting. The reels SERP used to
take the whole target until exhausted; it now gets a **cumulative slice** of the
per-keyword target via `_KeywordStream._PHASE_BUDGET` (reels 0.20 → topsearch
0.70 → recent 1.0), i.e. **reels 20% / topsearch 50% / recent 30%**; `clips` is
backfill-only. Deficits roll forward; if the weighted surfaces run dry below
target an uncapped backfill sweep (`_budget_mode=False`) resumes any live phase.

A bug in that mechanism discarded PAID media: when a phase filled its slice
mid-page it broke and dropped the rest of the already-fetched page, and could
mark itself saturated (so backfill never recovered it). This crushed yield —
e.g. a single rich reels page of 10 with a slice of 1 returned 1 post and lost
9; global pooling could not reclaim them. Fixed by stashing leftover in
`_phase_buffer` (drained free, no extra request, by the backfill sweep / a
raised-target re-pull) and by **not** advancing/exhausting a stream that stopped
only because the target was met (so pooling can re-pull it).

## Regression test
`workers/collection/adapters/test_hikerapi_adapter.py`:
- `test_topsearch_uses_raw_keyword_while_hashtag_phases_hashtagize` — asserts
  the topsearch phase sends the verbatim keyword and recent/clips still
  hashtagize.
- `test_reels_saturation_falls_through_to_topsearch_backfill` — saturation /
  backfill path through the topsearch phase.
- `test_budget_split_distributes_20_50_30_across_surfaces` — locks the 20/50/30
  split (target 10 → reels 2 / topsearch 5 / recent 3).
- `test_per_keyword_cap_fills_slice_then_backfills_in_order` +
  `test_global_trim_by_engagement_across_surfaces` — replace the old
  single-page engagement-cap test, split into the slice/backfill order path and
  the n_posts global engagement trim.
All 22 tests pass.

## Notes
- Not committed yet (working tree, branch `dev`).
- Related historical entry: `workers-hikerapi-fewposts-no-thumbnails.md`.
- Separate, still-open issue seen the same day: a HikerAPI IG split dispatched
  **0 requests** and was recorded as `status=success`/0 posts (silent empty).
  That is a different bug (0-yield logged as success) — not addressed here.
