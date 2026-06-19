# frontend — dashboard slow load: filter bar eagerly builds thousands of option elements

## Symptom
Dashboards for large-dataset agents load slowly even after the backend response
cache was added. Repro agent `f9022b29-…` (36 collections, 8554 posts, 24 MB
`/dashboard/data` payload). The recently-added response cache "didn't help".

## Measurement (chrome CPU profile + resource timing, via Playwright CDP)
Warm load split into two serial costs:
- `POST /dashboard/data`: ~1.6 s TTFB (gzip/serialize of a 23.9 MB all-posts JSON).
- **~2.9 s main-thread block** right after the data arrives.

CPU profile attributed the block almost entirely to `DashboardFilterBar.tsx`:
- `DashboardFilterBar.tsx:215` (the option `.map`) — **3058 ms self**.
- `jsxDEV` / `ReactElement` creation — **~1949 ms**.
- All client-side aggregation math combined — **~26 ms** (a red herring; benchmarked).

## Root cause
`FilterPill` rendered its option list as
`<PopoverContent>{filtered.map(o => <label><Checkbox/></label>)}</PopoverContent>`.
JSX children are evaluated **eagerly** during the parent render — even when the
popover is **closed** (Radix discards a closed popover's content, so the elements
are built and immediately thrown away; DOM had 0 checkboxes/labels). The active
filter bar had the high-cardinality dims entities (7362), themes (5074) and
channels (6106) → **~18.5K `<label><Checkbox/>` trees created per render** on
mount. The cache fixed the backend but never touched this FE cost.

## Fix
[DashboardFilterBar.tsx](../../frontend/src/features/studio/dashboard/DashboardFilterBar.tsx):
- Make `FilterPill`'s `Popover` controlled (`open`/`onOpenChange`) and **gate the
  option `.map` on `open`** — a closed pill builds zero option elements.
- Cap a *searchable* pill's rendered rows at `MAX_VISIBLE_FILTER_OPTIONS` (100)
  via the pure helper `visibleFilterOptions`, with a "+N more — type to search"
  hint. Users narrow high-cardinality dims through the existing search box.
  Non-searchable (low-cardinality) dims are never capped → unchanged.

After: `DashboardFilterBar` self-time **3137 ms → 70 ms** (~45×); the ~2.9 s
mount block is gone (main thread idle 6.9 s / 9.35 s window). Opening Entities
shows 100 rows + the more-hint, search narrows correctly, closing unmounts all
rows; Sentiment shows its 3 rows with no cap.

## Regression test
`filter-options-cap.test.ts` covers the pure `visibleFilterOptions` cap logic
(4 cases). The lazy-on-open behaviour has no RTL harness in this repo (same as
the prior `frontend-dashboard-slow-load-rerender` fix); verified empirically via
CPU profile + a Playwright interaction smoke check.

## Remaining (not in this fix — flagged for later)
The 24 MB "ship all raw posts, aggregate in the browser" model is the scalability
ceiling. At ~8.5K posts it's tolerable post-fix; at 50K+ it needs server-side
aggregation + paginated posts + server-built (capped) option lists.

## Commit
Branch `WidgetsAndBugFix`, not yet committed at time of writing.
