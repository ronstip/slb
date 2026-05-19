# IG multi-word hashtags + 0-post collections marked failed

## Repro
- Agent requests instagram with only multi-word keywords
  (e.g. `ייבוא מסין`, `import from china israel`).
- Before the fix: `_collect_instagram` dropped all multi-word keywords; no
  hashtag URLs left → adapter returned []; runner's `total_posts == 0`
  branch unconditionally marked the collection `status=failed,
  error_message="No posts were collected."`
- User intent was to **concat** the words (`#ייבואמסין`), not drop them; and
  more importantly, an empty result set should never fail the collection.

## Root cause
Two bugs in series:
1. `apify.py::_collect_instagram` filter (added in c27d6db) dropped every
   keyword containing whitespace. For Arabic test phrase `حقيبة هيرميس` this
   prevented a verified false-positive (prefix-match to `#حقيبة`), but it
   also nuked legitimate concat-hashtag cases (`social listening` →
   `#sociallistening`, a real tag) and broke any collection where every IG
   keyword happens to be multi-word.
2. `runner.py` `_run_crawl` marked `status=failed` whenever
   `total_posts == 0`, even when at least one adapter ran successfully. That
   conflated "no usable adapter / silent skip" with "ran cleanly, 0 matches"
   — a legitimate empty search surfaced to the user as a hard failure.

## Fix
- `apify.py::_collect_instagram`: drop the multi-word filter. `_hashtag_url`
  concats spaces; IG returns posts when the concat IS a real hashtag,
  prefix-match noise otherwise. Enrichment is the right place to filter
  noise, not the adapter — and the user explicitly preferred the noisy
  positive over the silent zero.
- `runner.py::_run_crawl`: a 0-post crawl is only a failure when no adapter
  ran (`not stats`) or every adapter errored (`bool(errors) and
  total_posts == 0`). Otherwise the run is left for `_set_final_status` to
  mark `status=success`. The error_message now disambiguates "no adapter
  ran" from "all platforms errored" so silent-platform-skip stays visible.

## Regression tests
- `workers/collection/adapters/test_apify_adapter.py::test_collect_instagram_concats_multi_word_keywords`
- `workers/collection/adapters/test_apify_adapter.py::test_collect_instagram_runs_when_all_keywords_multi_word`

## Related
- Failure example: collection `65fedf1b-9c9d-492b-8286-c428541b6126`
  (2026-05-19), Hebrew + English multi-word IG keywords.
- Memory: `project_silent_platform_skip.md` — the runner change makes the
  silent-skip diagnostic more specific (lists the platforms instead of the
  generic "No posts were collected").
