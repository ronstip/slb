# Data-tab KPIs capped at the page size (showed "500 posts")

## Symptom
On an agent's Data tab (`/agents/<id>?tab=data`), the KPI strip showed wrong
numbers - e.g. an agent with ~4,773 posts reported **"500 posts"**, and every
other metric (Views/Likes/Comments totals + averages, platform % and sentiment %
breakdowns, unique creators) was computed over only the top-500-by-views subset,
so all of them were skewed. Visible in prod (deployed 2026-06-12) too.

## Repro
1. Open the Data tab for any agent with > 500 posts.
2. KPI strip "Posts" reads 500; breakdown percentages don't match the real mix.

## Root cause
Commit `292d130` ("perf: cut /agents bundle 50% and unblock backend event loop")
lowered `PostsDataPanel`'s initial feed fetch from `limit: 5_000` to
`INITIAL_LIMIT = 500` to speed first paint (the table only renders 50 rows). But
the KPI strip (`AnalyticsStrip`) was computed client-side from that downloaded
array via `computeAnalyticsStats(filteredPosts)`. Once the array was capped at
500, the strip described only those 500 rows. For agents <= 5,000 posts the old
limit had covered the whole dataset, so the regression was invisible until the
cap dropped to 500.

## Fix
Move the strip's aggregates server-side so they're independent of the display
row cap, keeping the perf win (table still downloads only the top N):

- `api/routers/feed.py`: extracted `_build_tvf_filters` (shared WHERE/topic-join)
  and added `_build_tvf_kpis_sql` - aggregates total posts/views/likes/comments/
  shares + `COUNT(DISTINCT channel_handle)` + platform/sentiment/theme/entity
  breakdowns over the WHOLE filtered `scope_posts` window. `/feed` runs it in
  parallel (`asyncio.gather`) with the posts query when `include_kpis` is set
  (agent-scoped path only) and returns it as `FeedResponse.kpis`.
- `api/schemas/{requests,responses}.py`: `MultiFeedRequest.include_kpis`,
  `FeedKpis` model on `FeedResponse`.
- Frontend: `analyticsStatsFromFeedKpis` mapper in `AnalyticsStrip.tsx`;
  `PostsDataPanel` requests `include_kpis` and uses the server KPIs for the strip
  **when the post list is truncated** (falls back to client compute when the full
  set is loaded, so interactive column filters / search still drive the strip).

Behavior note: when truncated, the strip reflects the full server-filtered window
(platform/sentiment/date filters are sent to the server) and no longer reflects
purely client-side column filters / global search. "Load all" or a narrow enough
filter returns to exact client compute.

## Regression tests
- `api/tests/test_feed_kpis.py` - KPI SQL has full-window aggregates, no LIMIT,
  shares filters with the posts query.
- `frontend/src/features/collections/analytics-feed-kpis.test.ts` - mapper
  reports the full post count and maps breakdowns.

Verified against live BQ for agent `f9022b29-a5b5-41b7-8afd-910f296638a8`:
`total_posts: 4773` (was 500).

## Follow-ups (same session)

**Filter responsiveness.** First pass used the server KPIs whenever the list was
truncated - so client-side filters (per-column filters + global search) stopped
moving the strip, contradicting the table and the truncation banner ("Filters and
search apply to this subset"). Fixed in `PostsDataPanel`: the strip uses the
server KPIs only when **no client-side filter/search is active**
(`hasClientSideFilter = hasActiveFilters(columnFilters) || globalSearch`). The
server-side filters (source/platform/sentiment/date) are sent with the `/feed`
request, so they're already inside `data.kpis`; client-side filters fall back to
the client compute over the loaded subset, so the strip tracks them.

**Caching.** `include_kpis` runs a second `scope_posts` scan, so the bundle is now
cached via the dashboard's passive-invalidation cache
(`api/services/dashboard_cache.py::{get,set}_feed_kpis`). Key =
`(agent_id, sorted(collection_ids), freshness_stamp | filter_signature)`. The
stamp (max `collection_status.updated_at`, from the statuses already fetched for
access checks) busts the entry when data changes; `_kpis_filter_signature`
(platform/sentiment/dates/topic/has_media - not paging/sort) splits filter
combos. Cache hit -> the extra BigQuery scan is skipped entirely.

Tests extended in `api/tests/test_feed_kpis.py` (filter signature ignores paging,
cache keys on signature + stamp).

## Fix commit
Branch `DashboardDesign` (uncommitted at time of writing).
