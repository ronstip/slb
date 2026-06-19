# api-dashboard-studio-aggregation

## What was built

Studio (interactive) server-side widget aggregation — the last missing piece from
`docs/handoff-dashboard-payload-scalability.md`. The public share path already ran
server-side aggregation (default-ON, -98.6% payload). This feature brings the same
to the authenticated studio view, parameterized by live filter state.

## Root cause / motivation

Without this, every filter change in the studio triggered an O(posts × widgets)
aggregation loop in the browser thread. For large collections (9K+ posts, 16+
widgets) this blocked the main thread noticeably. The share path proved the server
can compute widget data in well under 1 s on a warm cache, so the studio needed
the same treatment.

## Implementation

### Backend

- **`api/schemas/requests.py`** — `DashboardAggregateRequest`: `collection_ids`,
  `agent_id`, `report_config`, `filters` (effective, already scope-intersected on
  the FE), `layout` (current widget list).
- **`api/services/dashboard_cache.py`** — `_studio_agg` TTLCache (512 entries),
  `get_studio_agg` / `set_studio_agg`. Key = `(agent_id, collection_ids,
  stamp|agg_sig)` where `agg_sig = MD5(filters + slim_layout + report_config)`.
  Drag-resize does NOT bust the cache (x/y/w/h stripped before hashing).
- **`api/routers/dashboard.py`** — `POST /dashboard/aggregate`:
  1. Auth + access check (same as `/dashboard/data`).
  2. Pulls posts from the shared core cache (no BQ round-trip on warm dashboard).
  3. Applies `report_transform.transform_posts` if `report_config` is present.
  4. Calls `apply_filters(posts, effective_filters)` to reproduce `filteredPosts`.
  5. Calls `build_widget_data_map` + `build_table_data_map` + `build_feed_data_map`.
  6. Caches result; returns `ORJSONResponse({widgetData, tableData, feedData})`.

### Frontend

- **`api/types.ts`** — `DashboardAggregateResponse`.
- **`api/endpoints/dashboard.ts`** — `getDashboardAggregate(...)`.
- **`SocialDashboardView.tsx`** — `useQuery` keyed on
  `[agent_id, collection_ids, reportConfig, effectiveFilters, widgetAggKey]`.
  - Disabled in edit mode (user needs instant client-side feedback during config).
  - `widgetsForGrid = useMemo(...)` merges server data onto visible widgets before
    passing to `SocialDashboardGrid`. Widgets absent from the server response keep
    client-side aggregation unchanged.
- **`DashboardView.tsx`** — destructures `effectiveFilters` from
  `useDashboardFilters`; passes `collectionIds` and `effectiveFilters` to
  `SocialDashboardView`.

## Regression test

`api/tests/test_dashboard_studio_agg.py` — 10 tests covering:
- 403 for unowned collection
- 400 for missing collection_ids
- No-filter path aggregates all posts (exact parity with `compute_custom`)
- Platform / sentiment / date_range filter narrowing
- Empty layout → empty maps
- Filter-that-matches-nothing → value 0
- Same filter twice → identical result
- Different filters → different results

## Verified in browser

- Default Dashboard (Dashboard Default layout, wc26brands agent, 9.8K posts):
  - Cold load fires `POST /dashboard/aggregate` → 200, `widgetData` contains
    `w3` (post_count 9777), `w5` (sentiment split), `w6` (emotion), `w9`
    (time-series grouped by sentiment). All render correctly.
  - Applying Platform = Instagram filter → new aggregate fires, `w3.value`
    drops to 4239, charts update live. ✓

## Key invariants to preserve

- `effectiveFilters` sent from FE is already scope-intersected (`intersectWithScope`
  was already done client-side). Server calls `apply_filters` only — NOT
  `intersect_with_scope`.
- `filteredPosts` is the percent baseline (`basePosts` in `SocialDashboardGrid`).
  Server uses the same filtered set as both the aggregation input and baseline.
- Server agg is disabled in edit mode — widgets must respond instantly to config
  changes without waiting for a round-trip.
- Cache key excludes layout positions (x/y/w/h) so drag-resize is free.
