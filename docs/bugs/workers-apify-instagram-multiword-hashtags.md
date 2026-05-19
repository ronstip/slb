# IG hashtag scraper returns off-topic noise for multi-word keywords

## Repro
- Agent with IG platform + non-ASCII multi-word keyword, e.g. `حقيبة هيرميس`
  (Arabic for "Hermès bag").
- `_hashtag_url("حقيبة هيرميس")` → `https://www.instagram.com/explore/tags/حقيبةهيرميس/`
- Live test against `apidojo/instagram-hashtag-scraper`: returns 3 items, all
  about `#حقيبة` (generic "bag") — none about Hermès.

## Root cause
IG hashtag search matches a single contiguous token. `_hashtag_url` collapses
spaces silently, so `"a b"` becomes `"ab"` — IG falls back to longest
prefix-match heuristics and returns posts tagged with `#a`. Other platforms
(TikTok, Reddit) handle multi-word keyword search natively; IG does not.

## Fix
`workers/collection/adapters/apify.py::_collect_instagram` now filters out
multi-word keywords (any internal whitespace after `#` strip) with a WARN log
before building hashtag URLs. Single-word keywords (incl. accented Latin and
non-Latin scripts like Arabic/Hebrew) still flow through unchanged.

## Regression test
`workers/collection/adapters/test_apify_adapter.py::test_collect_instagram_drops_multi_word_keywords`
and `::test_collect_instagram_skips_when_all_keywords_multi_word`.
