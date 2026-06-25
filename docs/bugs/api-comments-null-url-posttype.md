# Comments showed NULL url + NULL post_type in the data table

## Symptoms
In the data page → table (PostsDataPanel → `/feed`, `source=comments|both`):
1. **Post Type** column empty for comments (should be "comment").
2. URL icon **navigated to scolto.com** (the app origin) instead of the comment/post.
3. No parent-post context for short one-word comments.
4. Object custom fields rendered `[object Object]` in the expanded dropdown row.

## Root cause
Bugs 1 & 2 are one bug: the `comments` BQ table never modeled `comment_url` or `post_type`.
The `scope_comments` TVF and `_FEED_COMMENT_COLS` therefore hardcoded `CAST(NULL AS STRING)`
for both. The frontend did `post_url || ""` → `<a href="">`, and an empty `href` resolves to
the current origin (scolto.com). Comment URLs existed at the scrapers but only survived buried
in `platform_metadata` JSON (IG/FB), or weren't captured (X reply tweets are addressable;
YouTube only has a video URL; TikTok has none).

## Fix
Promoted `comment_url` + `post_type` to first-class columns, modeled at the source and streamed
through the whole path:
- `bigquery/schemas/comments.sql` — added `comment_url STRING`, `post_type STRING` (+ ALTER for the live table).
- `workers/collection/models.py` — `Comment.comment_url` / `Comment.post_type = "comment"`.
- Parsers — `apify_parsers.py` (IG/FB `commentUrl`, YouTube `pageUrl`), `x_api_parsers.py`
  (construct `x.com/<handle>/status/<id>`); TikTok left None.
- `workers/collection/normalizer.py` — `comment_to_bq_row` maps both.
- `bigquery/functions/scope.sql` `scope_comments` — `COALESCE(c.comment_url, par.post_url) AS post_url`,
  `COALESCE(c.post_type,'comment') AS post_type`, plus `par.content AS parent_post_content`
  (and `post_url`/`content` added to the `dedup_parent` CTE).
- `api/routers/feed.py` — projection cols unified with posts; builder maps `parent_post_content`.
- `api/schemas/responses.py` + `frontend/src/api/types.ts` — `parent_post_content` field.
- `frontend/.../ExpandedPostRow.tsx` — new "Parent Post" row (bug 3) + recursive `FieldValue`/
  `DictExpander` dict viewer replacing the stringify (bug 4).

Backfill of existing rows applied only to the hospitality agent
`4fd42299-287c-429d-8915-946f88886adc`; all other agents are fix-forward.

## Regression tests
`workers/collection/adapters/test_comment_url.py` — comment_url populated per platform
(IG/FB/X/YouTube), None for TikTok, post_type="comment", and survives `comment_to_bq_row`.

## Notes
- `scope.sql` is a BQ TVF — needs a DDL redeploy, not just a merge.
- Two pre-existing failures in `test_apify_*_comments.py` ("facebook/non-instagram still
  unsupported") are stale (FB comments were wired separately) and unrelated to this fix.

Fix branch: `dev` (uncommitted at time of writing).
