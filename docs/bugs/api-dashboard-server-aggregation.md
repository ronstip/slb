# Dashboard P2 — server-side aggregation (full share pipeline)

**Area:** api (+ frontend) · **Branch:** WidgetsAndBugFix (uncommitted) ·
**Status:** full pipeline shipped and **DEFAULT-ON** (gated by the
`DASHBOARD_SERVER_AGG` setting kill switch; `?agg=client` forces the legacy
full-posts path). Builds on P0a/P1/P0b. Full plan:
`docs/handoff-dashboard-payload-scalability.md`.

## Session 2 (2026-06-19) — follow-ups completed (all parity-gated)

- **#2 reportScope narrowing** (`api/services/dashboard_scope.py`): port of
  `intersectWithScope` + `applyFilters`. A share with a committed `reportScope` now
  pre-narrows the canonical posts (`apply_report_scope`) before aggregation, so
  scoped shares get correct server series + the payload drop instead of being
  skipped. Date filter is a UTC string-slice (reproducible). 13 parity cases
  (`scope_cases`) + router test.
- **#3 categorical heatmaps** (`compute_heatmap`/`is_server_heatmap`): 2D pivot
  (`groupedCategorical`) for CATEGORICAL axes only — cyclical (`hour_of_day`/
  `day_of_week`) and time (`posted_at`) axes are viewer-local / order-by-value, so
  they fall back to client. The FE heatmap renderer already consumes `serverData`
  verbatim (no FE change). 6 parity cases (`heatmap_cases`).
- **#5 post-mode table feed** (`compute_post_table_feed`/
  `is_server_post_table_feed`): a post-mode table sorted by a NUMERIC post-field
  (`like_count`/`view_count`/`comment_count`/`share_count`/`engagement_total`) ships
  a bounded post-id feed (via `build_feed_data_map`) and trips the omit-gate.
  String-sorted tables stay client-side (`localeCompare`). FE
  `ConfigurableTableWidget` gained a `serverPostIds` prop: in post-mode + readOnly
  it restricts to those posts before re-rendering rows. 5 parity cases
  (`post_table_feed_cases`) + string-sort-refusal unit test + router test.
- **#6 default-on rollout**: `DASHBOARD_SERVER_AGG: bool = True` in
  `config/settings.py` (global kill switch). Share endpoint:
  `server_agg_enabled = settings.dashboard_server_agg and agg not in ("client","off")`.
  FE `SharedDashboardPage` requests server-agg by default (opts out only on
  `?agg=client`/`off`). Env-synced to `scripts/deploy_prod.sh`,
  `.github/workflows/deploy.yml`, `.env.example`. Router tests cover default-on,
  the kill switch, and the `agg=client` escape hatch.

Tests after session 2: `test_dashboard_aggregate.py` 95 parity/edge cases,
`test_dashboard_share_server_agg.py` router wiring; full BE dashboard suite **330**
green, FE **332** + parity guard, `tsc` clean. Cold-load cascade (#1) fixed — see
`frontend-dashboard-autosize-render-cascade.md`. **Nothing committed yet.**

---

## Session 1 (original full-pipeline writeup)

## RESULT (measured live, flagship share `wc26brands`, 8554 posts)

`?agg=server` makes the share compute every widget server-side and, when the
whole layout is covered, ship only the bounded embed-feed union instead of all
posts. Measured: **raw 11,526,210 B → 159,820 B (−98.6%)**, **gzip wire
2,645,616 B → 41,974 B (−98.4%)**, **8554 posts → 10**. Post-count-independent:
the payload no longer grows with the dataset (50K posts would still be ~160KB).
All 16 flagship widgets render correctly from server data (browser-verified).

## Slices (each parity-gated by the cross-language golden harness)

1. **categorical** group-by + number-card primitive.
2. **per-widget filters** — `applyWidgetFilters` + `applyWidgetValueFilters`
   (conditions, value-prune, `post_count` group filter), `dashboard_widget_filters.py`.
3. **time-series** day/week/month, single + grouped + cumulative (refuses the
   viewer-local `hour`/cyclical buckets).
4. **group-table** (`compute_table`, numeric-sort only — JS `localeCompare` on
   string columns is locale-dependent, so those keep client aggregation).
5. **object-list** (`customobj:`) chart + object table — `dashboard_object_aggregate.py`
   (UNROUNDED avg, unlike aggregateCustom's `Math.round`).
6. **heatmap** — DEFERRED (not in the flagship; falls back to client).
7. **bounded feed + omit-gate** — `compute_embed_posts` + `layout_fully_covered`;
   when every widget is covered/static/feed the router drops `posts` to the feed
   union and ships `widgetData`/`tableData`/`feedData`/`serverComplete`. FE
   (`SharedDashboardPage` merges onto widgets; `CustomWidget`→serverData,
   `ConfigurableTableWidget`→serverRows, `EmbedsWidget`→serverPostIds).

## KNOWN FOLLOW-UP (not a functional break)

Intermittent **cold-load** React "Maximum update depth" re-render cascade on the
flagged share when `posts` collapses to the bounded set (self-settles; the
dashboard renders correctly; warm loads are clean; entirely behind the
off-by-default flag). Bisect proved the server-data CONSUMPTION is loop-free with
full posts — the cascade correlates with the bounded/empty global post set on a
slow (cold) data arrival, likely a grid auto-size/Chart.js-resize interaction.
Harden before flipping the flag on by default. (Original slice-1 doc content
below is superseded by the above.)

---

## (Original slice-1 notes)

## Goal

Stop shipping every post and aggregating client-side (payload is O(N posts)).
Compute each widget's `WidgetData` server-side and return compact series. This
slice proves the pipeline end-to-end on the **public share** (filter bar hidden →
static set) for the timezone-independent **categorical group-by + number-card**
primitive, gated by a cross-language parity harness. It is the durable
scalability fix's foundation; later slices fan out from the green harness.

## What shipped

- **Golden parity harness** (the gate): `frontend/src/features/studio/dashboard/__parity__/`
  - `parity_input.json` — hand-authored edge-case posts + categorical configs.
  - `parity.record.test.ts` — runs the REAL `aggregateCustom` and records
    `parity_fixtures.json` (the spec). `UPDATE_PARITY=1 npm test` regenerates;
    default run asserts the TS output still matches (guards spec drift).
- **Python engine** `api/services/dashboard_aggregate.py` — mirrors
  `aggregateCustom`'s number-card + single-dim categorical paths byte-for-byte,
  incl. JS `Math.round` (half-away-from-zero via `floor(x+0.5)`) and JS
  `String()` number formatting (`5.0` → `"5"`). `is_server_aggregatable(widget)`
  is a conservative eligibility predicate; `build_widget_data_map(posts, layout)`
  fans out over a share layout. Anything outside the slice raises
  `NotAggregatable` → caller keeps client aggregation.
- **Share endpoint** (`api/routers/dashboard_shares.py`): new opt-in query param
  `?agg=server` → returns a top-level `widgetData` map (widget id → `WidgetData`)
  for eligible widgets, computed over the canonicalized posts (pre-slim). Off by
  default → unflagged response is byte-identical to before. The flag is folded
  into `share_cache_key` so flagged/unflagged bodies never collide.
- **Frontend**: `getSharedDashboardData(token, {serverAgg})` opts in via
  `?agg=server`; `SharedDashboardPage` reads the `agg` URL param, passes it
  through, and merges `widgetData` onto layout widgets as `serverData`;
  `CustomWidget` uses `widget.serverData` verbatim when present and `!isEditMode`
  (local fallback otherwise). `serverData` is transient/view-only, never saved.

## Scope / guardrails

- **NOT covered (kept client-side, by design):** time-series & cyclical dims
  (`posted_at`/`hour_of_day`/`day_of_week` — viewer-local timezone, not
  server-reproducible), breakdown (2D) pivots, heatmap, list[object]
  (`customobj:`) metrics, `computed:` expr/if-else metrics, and any widget with
  per-widget filters or a runtime metric toggle.
- `scope_posts` / `build_dashboard_sql` untouched. Canonicalization still runs
  upstream (`report_transform.transform_posts`); the engine aggregates the same
  canonical posts.
- **No payload win yet:** posts still ship (other widgets need them). The
  payload only drops once every post-consuming widget on a share is server-
  satisfied + embed/table widgets serve a bounded post feed (later slices).
  The flagship `wc26brands` needs object-list + grouped-time-series + bounded
  feed before it qualifies.

## Tests

- `api/tests/test_dashboard_aggregate.py` — 25 parity cases vs the TS golden +
  JS-semantics edge cases (`_js_string`/`_js_round`), topN/Others, NotAggregatable
  guards, eligibility predicate. (47 assertions)
- `api/tests/test_dashboard_share_server_agg.py` — router wiring: unflagged has
  no `widgetData`; flagged covers only eligible widgets with correct values;
  layout returned untouched.
- `parity.record.test.ts` guard (part of `npm test`, 332 FE tests green).
- 255 BE dashboard/share/report/response/aggregate tests green; `tsc --noEmit` clean.

## Next slices (parity-gated, from the green harness)

1. Time-bucket primitive (day/week/month ONLY — refuse hour/local-tz), then
   grouped time series. 2. Group-table primitive. 3. Object-list aggregation
   (`object-list-aggregations.ts`). 4. Per-widget conditions/value-filters (reuse
   `report_transform.match_condition`). 5. Bounded post feed for embed/text
   widgets + the "omit full posts when the whole layout is server-satisfied"
   payload gate (the actual scalability win). 6. Studio (interactive) via
   per-filter-signature caching.
