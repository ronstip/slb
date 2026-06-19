# Handoff: Dashboard data payload — scalability / load performance

**You are the next agent on dashboard load performance.** Prior sessions shipped,
on branch `WidgetsAndBugFix` (uncommitted, NOTHING committed yet):
**P0a** (batched share freshness reads), **P1** (payload slimming + lazy detail
fetch), **P0b** (cached gzipped response bytes), and **P2 server-side aggregation
for the public share — now DEFAULT-ON** including the session-2 follow-ups
(reportScope #2, categorical heatmaps #3, post-mode table feeds #5, default-on
rollout #6) and the cold-load cascade fix (#1). All live-verified.

**The one big thing left is the STUDIO (interactive) aggregation path** — P2 only
covers the public share (static, filter-bar-hidden). Studio needs per-filter-
signature aggregation; it's a separate, larger plan (see "REMAINING FOLLOW-UPS").
Read the **"P2 — server-side aggregation"** section below first; it's current.

> **Re-verify before implementing.** Treat numbers as hypotheses to re-measure on
> current code. The `scope_posts` TVF was wrongly blamed once; the warm cost was
> wrongly attributed to orjson once. **Measure, don't assume.** The parity golden
> is the spec for the engine — never hand-edit it; regenerate from the TS side.

---

## Goal

Make dashboards (studio `POST /dashboard/data` AND public share
`GET /dashboard/shares/public/{token}`) load fast and **scale to 50K+ posts**.
The payload is the ceiling: it ships the raw posts table and aggregates
client-side, growing linearly. P1/P0b cut the *constant*; P2 removes the *growth*.

---

## What is DONE (branch `WidgetsAndBugFix`, uncommitted)

### P0a — share freshness reads batched
`FirestoreClient.get_collection_statuses()` (one `get_all`) replaces the
per-collection freshness reads in the share path
(`workers/shared/firestore_client.py`, `api/routers/dashboard_shares.py`).
Bug log: `docs/bugs/api-dashboard-payload-slimming.md`.

### P1 — payload slimming + lazy detail fetch (BE + FE, live-verified)
The bulk payload **omits the 3 heavy display-only fields** and the FE lazy-fetches
them per *visible* post. Measured live (share `wc26brands`, 8554 posts):
**raw 25.1MB → 11.5MB (−54%), gzip wire 6.5MB → 2.62MB (−60%).** Bug log:
`docs/bugs/api-dashboard-payload-slimming.md`.

- **`DETAIL_FIELDS = (ai_summary, context, media_refs)`** in
  `api/services/dashboard_service.py` — fields read solely for the bounded
  on-screen set (gallery thumbnails, expanded rows, the `ai_summary` post-mode
  table column), never in aggregation/filtering. `content` is kept (filterable via
  the `text` condition).
- BE helpers (in `dashboard_service.py`): `strip_detail_fields()` (non-mutating),
  `build_post_details()` (scoped to the cached core = the access boundary),
  `get_or_build_core()` (shared core loader so data + details hit the SAME cache).
- BE endpoints: `/dashboard/data` takes `slim: bool`; share takes `?slim=1`. Two
  detail endpoints serve the stripped fields from the cached core (NO extra BQ):
  `POST /dashboard/post-details` (authed) +
  `POST /dashboard/shares/public/{token}/post-details` (tokenless).
- FE: `use-post-details.tsx` (provider + `usePostDetails` hook; batched, de-duped,
  cached). `DashboardDetailsProvider` wraps the grid in `SocialDashboardView`; both
  hosts (`DashboardView`, `SharedDashboardPage`) inject a token/collection-scoped
  fetch fn. Three consumers lazy-resolve: `EmbedPostGallery` (thumbnails),
  `LazyExpandedPostRow` (expand), `ConfigurableTableWidget` (`ai_summary` column).
  `slim` is **opt-in**; non-slim callers (`StatsTab`, agent-overview) unchanged.
- **Guardrail-safe:** slimming is response-layer only; `scope_posts` /
  `build_dashboard_sql` untouched.

### P0b — cache the gzipped response bytes (backend-only, live-verified)
Warm hits used to re-serialize + re-compress the full payload every request. Now
the final **gzipped** body is cached, so a warm hit is a key lookup + send. New
module `api/services/dashboard_response.py` (byte cache + `gzipped_json_response` +
`data_cache_key`/`share_cache_key`), wired into both routers; `GZipMiddleware`
dropped to `compresslevel=6` in `api/main.py`. Bug log:
`docs/bugs/api-dashboard-response-gzip-cache.md`.

**Two corrections to the original brief, confirmed by measurement:**
- **The warm cost was gzip, not orjson.** orjson encode of the 11.5MB slim payload
  = **32ms**; the cost is **gzip at Starlette's default level 9** (366ms slim /
  ~1.9s full). The cache stores the *gzipped* body; level 6 (same ratio, ~40% less
  CPU) is now the global default.
- **The proposed cache key was insufficient for shares.** `(cache_key +
  report_config + slim)` is fine for the authed path (`data_cache_key`) but the
  SHARE body also embeds `title`/`layout`/`filterBarFilters`/`reportConfig` from
  Firestore that change independently of the freshness stamp. `share_cache_key`
  folds a metadata hash in, so an owner edit busts the cache (no stale layout).

**Bypass is safe:** Starlette 0.52 forwards a body already carrying
`Content-Encoding: gzip` verbatim (no double-compress) — pinned by an integration
test. Identity clients get a fresh, uncached orjson body.

**Result (warm, share `wc26brands`):** gzip warm CPU removed on cache hits —
slim 0.74s→0.14s, full 1.87s→0.05s. gzip body decodes byte-identical to identity.
Tests: `api/tests/test_dashboard_response_cache.py` (11) + 207 dashboard/share/
report/response tests green.

### Architecture you MUST understand before touching this
- The **cache (`DashboardCache`) stores the FULL assembled core** (all fields).
  Slimming happens at *response assembly*; the detail endpoints read the same
  cached core. Do NOT "fix" the cache to store slim posts — the detail endpoints
  depend on the full core being cached.
- The freshness-stamp passive-invalidation contract is unchanged
  (`api/services/dashboard_cache.py`). The **response-bytes cache**
  (`dashboard_response.py`) layers on top, keyed by stamp + config/slim
  (+ share metadata hash).
- **NEW finding (important for P2 / perf next):** the warm **wall-clock** TTFB
  floor (~1.9s on the dev box, both endpoints) is **Firestore metadata
  round-trips**, NOT serialization — proven because the share `post-details`
  endpoint (1KB body, no transform/gzip) is also ~1.9s warm. That floor is dev→GCP
  network latency; in prod (Cloud Run colocated with Firestore) it is ~tens of ms,
  so it is **NOT a prod bottleneck**. Don't chase it. If prod RTT ever proves
  material, parallelize / short-TTL-cache the share metadata reads (share doc,
  agent collections, statuses) — separate from P0b and P2.

### P1 leftover (optional)
`ai_summary` lazy-merge is wired for the `ConfigurableTableWidget` post-mode column
and the expanded row. If a NEW widget surfaces a `DETAIL_FIELD` across all posts,
wire it the same way (or it shows empty until fetched).

---

# ════════════════════════════════════════════════════════════════════════════
# P2 — server-side aggregation (the durable scalability fix) — IMPLEMENTED + ON.
# Read THIS section first. Updated 2026-06-19 (session 2), branch `WidgetsAndBugFix`.
# ════════════════════════════════════════════════════════════════════════════

**Status: full SHARE pipeline shipped and DEFAULT-ON** (gated by the
`DASHBOARD_SERVER_AGG` setting — the global kill switch; default `True`). The
original plan (categorical → … → omit-posts gate) is built end-to-end for the
public share, plus the session-2 follow-ups: **reportScope narrowing (#2),
categorical heatmaps (#3), post-mode table feeds (#5), and the default-on
rollout (#6)**. The cold-load re-render cascade (#1) is fixed. Everything below
the "Appendix — original plan" divider is the pre-implementation proposal, kept
for reference.

> **Session-2 update (2026-06-19):** the flag flipped from opt-in `?agg=server`
> to **default-on**. The share endpoint now server-aggregates unless the
> `DASHBOARD_SERVER_AGG` setting is off OR the request carries `?agg=client`
> (`?agg=off`) — the debug escape hatch for the legacy full-posts path. The FE
> (`SharedDashboardPage`) requests it by default and only opts out on
> `?agg=client`. Nothing is committed yet — see "Before deploying to prod".

### TL;DR of what changed
Before, the share shipped **all posts** and the browser aggregated each widget
client-side → payload was **O(N posts)** (11.5MB / 8.5K posts → ~65MB / 50K).
Now the **server computes each widget** and — when it can compute *every* widget
on the layout — **drops the posts array entirely**, shipping only compact
per-widget results + a tiny bounded post feed for embeds/post-tables.

**Measured live, flagship share `wc26brands` (8554 posts):**
raw **11,526,210 B → 159,820 B (−98.6%)**, gzip wire **2,645,616 B → 41,974 B
(−98.4%)**, **8554 posts → 10**. Post-count-independent (50K posts ≈ same KB).
All 16 widgets render correctly (browser-verified, default-on, cold + warm).
`?agg=client` still returns the full 11,526,210 B legacy body.

### How it works (the model)
1. The share endpoint canonicalizes posts (unchanged `transform_posts`), then —
   only when `?agg=server` — runs the **aggregation engine** over them to build:
   - `widgetData{widgetId → WidgetData}` for chart/number widgets,
   - `tableData{widgetId → rows}` for group/object tables,
   - `feedData{widgetId → [post_id,…]}` for embed (collection) widgets.
2. **Omit-gate:** if EVERY widget is server-satisfied (`layout_fully_covered`:
   covered by widgetData/tableData/feedData, OR static text/media), the body's
   `posts` is replaced by just the **bounded union of feed posts** (≤ a few
   dozen) and `serverComplete=true`. Otherwise `posts` stays the full set so any
   uncovered widget still aggregates client-side (current behaviour preserved).
3. The FE (`SharedDashboardPage`) merges those maps onto each layout widget
   (`serverData` / `serverTableRows` / `serverPostIds`); the widget components use
   them verbatim in read-only mode and **fall back to local aggregation when
   absent** (so any unsupported widget — or the studio — is unaffected).

### Why keep both paths (kill switch + escape hatch)
Server-agg is **default-on** but every layer keeps the legacy path one toggle
away: the `DASHBOARD_SERVER_AGG` setting is a global kill switch (flip to off →
all shares revert to full-posts, no redeploy of code), and `?agg=client` forces
the legacy body per-request for debugging. The resolved on/off bool is folded
into `share_cache_key`, so the two bodies never collide in the response cache.
It also self-heals: any widget the engine can't reproduce keeps client
aggregation, so the feature is generic and safe for **all** dashboards, not just
the flagship — the server response is always a strict superset.

### File map
- **Engine (BE, Python):**
  - `api/services/dashboard_aggregate.py` — `compute_custom` (categorical +
    number-card + time-series day/week/month, single + grouped + cumulative),
    `compute_table` (group tables), **`compute_heatmap` + `is_server_heatmap`
    (#3, categorical axes only)**, eligibility (`is_server_aggregatable`,
    `is_server_table`), fan-out (`build_widget_data_map`, `build_table_data_map`),
    bounded feed (`compute_embed_posts`, **`compute_post_table_feed` +
    `is_server_post_table_feed` (#5)**, `build_feed_data_map`) + `layout_fully_covered`.
  - `api/services/dashboard_scope.py` — **#2 reportScope narrowing**: port of
    `intersectWithScope` + `applyFilters` (`apply_report_scope`), run over the
    canonical posts before aggregation when a share has a committed `reportScope`.
  - `api/services/dashboard_widget_filters.py` — port of `applyWidgetFilters` +
    `applyWidgetValueFilters` (row filters, conditions, value-prune, `post_count`
    group filter).
  - `api/services/dashboard_object_aggregate.py` — `customobj:` element-as-unit
    charts + object tables (`compute_object_list`, `compute_object_table`).
- **Router:** `api/routers/dashboard_shares.py` (`get_shared_dashboard` — the
  `agg` query param **(default-on via `DASHBOARD_SERVER_AGG`; `client`/`off`
  forces legacy)**, `apply_report_scope`, the three maps, the omit-gate,
  `serverComplete`).
- **Setting / kill switch:** `config/settings.py` (`dashboard_server_agg: bool =
  True`); env-synced to `scripts/deploy_prod.sh`, `.github/workflows/deploy.yml`,
  `.env.example` (`DASHBOARD_SERVER_AGG=true`).
- **Cache key:** `api/services/dashboard_response.py` (`share_cache_key` folds the
  resolved `agg_enabled` bool).
- **FE:** `frontend/src/features/studio/dashboard/SharedDashboardPage.tsx`
  (**default-on**: requests server-agg unless `?agg=client`/`off`; merges the maps
  onto the layout); `SocialWidgetRenderer.tsx` (`CustomWidget`→`serverData`
  [charts + heatmap], `ConfigurableTableWidget`→`serverRows` [group tables] +
  **`serverPostIds` [post-mode table feed, #5]**, `EmbedsWidget`→`serverPostIds`);
  `api/endpoints/dashboard.ts` (`getSharedDashboardData(token,{serverAgg})` →
  `agg=server`/`agg=client`); types in `types-social-dashboard.ts`
  (`serverData/serverTableRows/serverPostIds`) + `api/types.ts`
  (`widgetData/tableData/feedData/serverComplete`).
- **Parity harness:** `frontend/src/features/studio/dashboard/__parity__/`
  (`parity_input.json`, `parity.record.test.ts`, generated `parity_fixtures.json`).
  Now also records `heatmap_cases` (#3), `post_table_feed_cases` (#5), and
  `scope_cases` (#2 — uses exported `intersectWithScope`/`applyFilters`/
  `INITIAL_FILTERS` from `use-dashboard-filters.ts`).
- **Tests:** `api/tests/test_dashboard_aggregate.py` (95 cases: cross-language
  parity for custom/table/object/**heatmap/post-table-feed/scope** + edge cases +
  eligibility), `api/tests/test_dashboard_share_server_agg.py` (router wiring +
  omit-gate + **default-on/kill-switch/`agg=client`/reportScope/heatmap/post-table
  feed**).

### Parity harness — the safety gate (HOW TO EXTEND A WIDGET TYPE)
The TS aggregators ARE the spec. `parity.record.test.ts` runs the REAL TS
functions over `parity_input.json` and records `parity_fixtures.json`; the Python
engine must reproduce every `expected` byte-for-byte (asserted in
`test_dashboard_aggregate.py`). Workflow to add coverage safely:
1. add fixture cases (posts/config) to `parity_input.json`;
2. `cd frontend && UPDATE_PARITY=1 npx vitest run src/.../__parity__/parity.record.test.ts`
   to regenerate the golden from the TS spec;
3. implement/extend the Python engine until `pytest api/tests/test_dashboard_aggregate.py`
   is green. Never hand-edit the golden. Default `npm test` re-asserts the TS
   output against the golden (guards the spec from drift).

### Parity traps already handled (don't regress these)
- **Timezone:** FE buckets `hour`/`hour_of_day`/`day_of_week` and the preset
  volume/sentiment-over-time/engagement-rate use **browser-local** time → NOT
  server-reproducible. Only `day`/`week`/`month` (UTC string-slice) are supported;
  the rest raise `NotAggregatable` → client fallback.
- **`Math.round` is half-away-from-zero** (use `floor(x+0.5)`, NOT Python `round`).
- **`String(5.0) === '5'`** (JS drops the `.0`); booleans lowercase.
- **Object-list uses UNROUNDED avg** (`sum/count`), unlike `aggregateCustom`.
- **Table string-sort uses `localeCompare`** (locale-dependent, not stable even
  across the client's own users) → only NUMERIC-sort tables are server-covered.
- **Heatmap (#3) is CATEGORICAL-AXIS ONLY.** `resolveHeatmapAxis` orders cyclical
  axes (`hour_of_day`/`day_of_week`) by a canonical local-tz cycle and time axes
  (`posted_at`) by value (not date) — `is_server_heatmap` refuses both (+ object/
  computed/object-leaf dims and metric toggles) → those keep client aggregation.
  Note the FE increments BOTH x- and y-axis totals once per (x,y) cell pair.
- **Post-mode table feed (#5) is NUMERIC-SORT ONLY.** `aggregateTablePostMode`
  sorts string columns via `localeCompare`, and a MISSING value coerces to `''`
  (string path) — so only the always-numeric count/engagement post-fields
  (`like_count`/`view_count`/`comment_count`/`share_count`/`engagement_total`) give
  a reproducible top-`rowLimit` selection. JS stable-sort tie order = original
  order → Python `sorted(..., reverse=(dir!='asc'))` matches.
- **reportScope (#2) date filter is a UTC string-slice** (`posted_at[:10]`),
  identical on both sides — NOT timezone-dependent (unlike time-series bucketing).

### ✅ FIXED (2026-06-19)
**Cold-load re-render cascade** — root-caused and fixed in
`SocialDashboardView.tsx`. Root cause: `useSyncExternalStore` (used by Zustand)
bypasses React 18's automatic batching, so rapid concurrent `setWidgets` calls
from multiple ResizeObserver debounces on fast-rendering paths (trivial
client-side work with bounded 10-post payload) caused each Zustand notify to
fire a *synchronous* React re-render mid-frame. Fix: `handleAutoSize` now
collects pending height updates in a `Map` ref and flushes them in a SINGLE
`setWidgets` call from `requestAnimationFrame` (after the current work-loop
completes). The rAF-debounced batching also means multiple auto-sizing widgets
that settle in the same frame cost ONE store update instead of N. See
`docs/bugs/frontend-dashboard-autosize-render-cascade.md`.

**Defense-in-depth (session 2):** added `scrollbar-gutter: stable` on `html`
(`globals.css`) so a page whose height hovers near the viewport can't flip the
vertical scrollbar on/off and oscillate the RGL container width
(width→relayout→height→scrollbar feedback). Plus a **dev-only** auto-size churn
detector in `handleAutoSize` (warns if >20 height-changing flushes land in 2s,
naming the offending widget) so any residual oscillation is diagnosable on the
next occurrence. The cascade could not be reproduced on demand even on a genuine
cold cache across 7 conditions — so watch the dev console on real cold loads
before treating it as fully closed.

### ✅ DONE this session (2026-06-19, session 2) — all parity-gated, uncommitted
- **#2 reportScope narrowing** — `dashboard_scope.py`; scoped shares now
  aggregate over the narrowed set (and win the payload drop) instead of being
  skipped. 13 parity cases + a router test.
- **#3 categorical heatmaps** — `compute_heatmap`/`is_server_heatmap`; 6 parity
  cases. Cyclical/time-axis heatmaps still fall back to client (local-tz).
- **#5 post-mode table feed** — `compute_post_table_feed`/
  `is_server_post_table_feed`; numeric-sort post-mode tables ship a bounded
  post-id feed and trip the omit-gate. FE `ConfigurableTableWidget` renders from
  `serverPostIds`. 5 parity cases + string-sort-refusal + router test.
- **#6 default-on rollout** — `DASHBOARD_SERVER_AGG` setting (default `True`,
  global kill switch) + `?agg=client` escape hatch; FE requests it by default;
  env-synced to `deploy_prod.sh`/`deploy.yml`/`.env.example`.

### ⚠ REMAINING FOLLOW-UPS (for the next session)
1. **Studio (interactive) path — the big one, NEW SESSION.** Everything done so
   far is the public share only (filter bar hidden → static set). Studio is
   interactive: server aggregation must be parameterized by the live filter
   state and cached per filter signature (reuse the `get_feed_kpis`/`filter_sig`
   cache pattern in `dashboard_cache.py`). Separate, larger plan.
2. **Non-categorical heatmaps** stay client-side: cyclical axes
   (`hour_of_day`/`day_of_week`) are inherently viewer-local; `posted_at` heatmap
   axes order by value not date. Only port if a real share needs them.
3. **`data-table` widget variant** (if distinct from chartType `table` post-mode)
   — confirm it routes through the same `ConfigurableTableWidget` path; the #5
   feed only covers `chartType: 'table'` + `mode: 'post'`.
4. **Verify the cold-load cascade in the wild.** It's fixed by construction
   (rAF batching) + hardened (scrollbar-gutter) but was never reproduced; the
   dev-only churn warning will surface any residual. Confirm over a few real cold
   loads before considering it closed.
5. **Commit + deploy.** Nothing is committed yet (see "Before deploying to prod").

### Before deploying to prod (nothing committed yet)
The user is staging this for a deliberate prod cutover. Checklist:
- **Commit** the working tree (session-1 P0a/P1/P0b/P2 + session-2 #2/#3/#5/#6 +
  the cascade fixes). All on branch `WidgetsAndBugFix`.
- **Env sync is done** — `DASHBOARD_SERVER_AGG=true` is in `deploy_prod.sh`,
  `deploy.yml`, `.env.example`. The code default is also `True`, so prod is on
  even if the env var is dropped; set it to `false` to kill-switch without a code
  change.
- **Watch the dev console** on a few real cold loads for the
  `[dashboard] auto-size still oscillating` warning before trusting the cascade
  fix in prod.
- **Roll-back plan:** `DASHBOARD_SERVER_AGG=false` (or `?agg=client` per link)
  reverts to the proven full-posts path with no code change.

### How to run / measure / verify
- Dev: FE `http://localhost:5174`, API from repo root
  `.venv\Scripts\python -m uvicorn api.main:app --host 127.0.0.1 --port 8000`
  (NO `--reload` for stable measuring). **One request at a time** — concurrent
  cold hits wedge the dev server (thread-pool saturation). NOTE: the API has no
  `--reload`, so **restart it after any BE change** before measuring/browser-checks.
- Payload (default-on now): `curl -s "…/dashboard/shares/public/wc26brands?slim=1"
  -H "Accept-Encoding: identity" -w "%{size_download}\n"` → ~159,820 B (bounded);
  add `&agg=client` → 11,526,210 B (legacy full posts). The bounded body has
  `serverComplete`, a ~10-post `posts`, and `widgetData`/`tableData`/`feedData`.
- Browser: open the plain `…/shared/wc26brands` (default-on) vs
  `…/shared/wc26brands?agg=client`; both must render identically.
- Tests (repo root): `$env:GCP_PROJECT_ID="x"; .venv\Scripts\python -m pytest
  api/tests/test_dashboard_aggregate.py api/tests/test_dashboard_share_server_agg.py -q`
  (95 parity + edge/eligibility, + router wiring). FE: `cd frontend && npx vitest
  run` (incl. the parity guard, 332) + `npx tsc --noEmit`. Full BE dashboard suite
  green: **330** (`-k "dashboard or share or report or response or aggregate or
  filter or object or collection or scope"`).
- Parity workflow to extend a widget type: add cases to `parity_input.json` →
  `cd frontend && UPDATE_PARITY=1 npx vitest run src/.../__parity__/parity.record.test.ts`
  → implement Python until `pytest api/tests/test_dashboard_aggregate.py` is green.
  Never hand-edit the golden.

### What's left (continue here, in priority order)
1. **[do next] Flip to default-on** (issue #1 above) — cold-load cascade fixed,
   gate removed. Add settings flag, FE always `agg=server` for shares, deploy sync.
2. reportScope narrowing (issue #2) so scoped shares also win.
3. Studio interactive path (issue #4) — the larger second phase.
4. Heatmap (#3) + post-mode/data-table feed (#5) for full per-share coverage.

Bug log with the same detail: `docs/bugs/api-dashboard-server-aggregation.md`.
Memory: `project_dashboard_p2_server_aggregation`.

---

# ════════════════════════════════════════════════════════════════════════════
# Appendix — original P2 plan (historical, pre-implementation). Superseded by the section above.
# ════════════════════════════════════════════════════════════════════════════

Slimming/gzip-caching cut the constant, but the payload is still **O(N posts)**
(~11.5MB/8.5K → ~65MB/50K). P2 computes each widget's numbers server-side and
returns compact series (KB/widget, post-count-independent).

### The real constraint (why this is hard, not just big)
The dashboard is **interactive**. The studio filter bar lets a user filter by
platform / sentiment / date / topic / custom field at runtime, and **every widget
re-aggregates instantly, client-side, over the filtered post set** — that is why
all posts ship today. Any server aggregation must answer: *aggregate over which
filter state?* Naive "pre-bake the aggregates" is only correct when the filter
state is fixed. Two surfaces, very different:
- **Public share** — filter bar is hidden (`filterBarHidden`) → displayed set is
  **static**. No combinatorial filter problem, and it's the viral, scale-sensitive
  surface. → **the natural first target.**
- **Studio** — interactive → server aggregation means **on-demand per-widget
  aggregation parameterized by the current filter state**, cached per filter
  signature (the `/feed?include_kpis` path already does this — see `get_feed_kpis`
  / `filter_sig` in `dashboard_cache.py`). Larger; second phase.

### Parity is the dominant risk
The FE aggregation logic IS the spec and must stay **row-identical**:
- `frontend/src/features/studio/dashboard/dashboard-aggregations.ts` (1331 lines):
  `getMetricValue`, `getDimensionKeys`, `bucketDate`, `aggregateCustom`,
  `aggregateTable`, `aggregateHeatmap`, plus ~20 fixed-widget aggregators.
- `api/services/report_transform.py`: canonicalization (remap-then-dedupe within
  each post's multivalued array — the no-double-count invariant), expr metrics
  (**aggregate-then-evaluate**, div/0 → None), if/else computed fields.
- There is a parity-test culture already (`api/tests/test_dashboard_schema_parity.py`,
  memory `feedback_dashboard_schema_parity`).

**Insight that shrinks the surface:** the ~25 aggregators collapse to ~4
primitives, parameterized:
1. group-by-dimension + metric (sum/count/avg) — sentiment, platforms, themes,
   entities, content types, languages, channels, emotions, theme cloud, custom
   bar/pie.
2. time-bucketed group-by — volume/sentiment/engagement over time, heatmap.
3. table — group-by with N metric columns + ordering + `rowLimit`.
4. KPIs — **already server-side** (`build_dashboard_kpis_sql`).

The hard part is the **semantics**, not the SQL: multivalued dedupe-within-post
then explode, canonicalization, expr/if-else, `getDimensionKeys` edge cases
("unknown" bucketing, custom object-leaf fields), tie-break/ordering.

### Recommended approach — vertical tracer-bullet, parity-gated, behind a flag
Do NOT re-implement all 25 aggregators up front. Prove the pipeline on ONE widget
end-to-end with a golden parity harness, then fan out.
1. **Golden parity harness first (no behavior change).** Capture `(posts, config)
   → expected series` fixtures by running the real TS aggregators (node harness or
   recorded outputs from `wc26brands` + a canonicalization-heavy dashboard). A
   Python engine must reproduce them byte-for-byte. This harness gates every
   widget type before it ships.
2. **Slice 1 — share, one primitive (group-by-dimension + metric).** Build the
   Python engine for primitive #1, wire a server-aggregated path for that widget
   type on the SHARE endpoint behind a per-widget flag, prove parity, ship.
3. **Slice 2..4 — remaining primitives on the share** (time-bucket, table,
   heatmap), each parity-gated. The share then drops to compact series + a
   paginated post feed for embed/table widgets → payload becomes KB/widget,
   post-count-independent. **This alone fixes the share scale ceiling.**
4. **Studio (phase 2).** On-demand per-widget aggregation keyed by filter
   signature (reuse the `filter_sig` cache pattern). Separate plan.
5. **Filter-bar options server-side** (capped top-N + counts) — partially
   addressed already by the FE filter-bar fix
   (memory `project_dashboard_fe_filterbar_bottleneck`); revisit once posts are
   paginated.

### Guardrails (non-negotiable)
- **Do NOT change `scope_posts` / `build_dashboard_sql`.** It is the single source
  of truth for feed, data tab, topics, briefings. Prefer **ADDITIVE** aggregate
  queries over touching the shared TVF. Prove row-identical.
- **Canonicalization happens before aggregation.** Either pre-canonicalize in
  Python (reuse `report_transform.canonicalize_posts`) feeding the engine, or
  encode the maps in SQL — the Python route is far lower parity risk.
- Engine returns the same shapes the FE widgets already consume, so the FE switch
  is "use server series if present, else aggregate locally" — keeps a fallback.

### Open questions for the grilling pass
- **Python engine over the cached core** (reuse `report_transform`, easiest parity,
  no TVF risk) vs **BigQuery** (scales past the 10K `MAX_ROWS` cap, but parity for
  expr/if-else/canonicalization is much harder)? **Recommendation: Python over the
  core first**; push to BQ only for dashboards that exceed the row cap.
- Does the 10K `MAX_ROWS` truncation matter for any live dashboard yet? If nothing
  is near 10K-after-this, Python-over-core may suffice for a long time.
- Embed/table widgets need actual posts (not aggregates) — pagination contract +
  how it interacts with the lazy `post-details` endpoint.
- Studio filter-bar latency budget: acceptable per-interaction round-trip, or must
  aggregates be precomputed for common filters?

### Effort
Multi-session. Slice 0 (harness) + Slice 1 (one share widget, parity-gated) is the
reviewable first milestone; everything else fans out from a green harness.

---

## How to reproduce & measure

Dev servers: FE `http://localhost:5174`, API `http://localhost:8000`. The
**share URL is public** (easiest): `http://localhost:5174/shared/wc26brands`.
API route: `GET /dashboard/shares/public/wc26brands`.

> **Operational caution:** do NOT fire several cold requests concurrently right
> after an API `--reload` — each cold dashboard hit blocks 4+ threads on BigQuery
> and the dev server wedges (thread-pool saturation). Measure ONE request at a
> time, sequentially; let the first cold miss warm the cache.

- **Payload size + TTFB:** `curl` the endpoint. `-H "Accept-Encoding: identity"`
  → raw bytes (`%{size_download}`); `-H "Accept-Encoding: gzip"` → wire bytes.
  `?slim=1` toggles slim. `%{time_starttransfer}` ≈ server work (download is ~ms on
  localhost). `--compressed` auto-gunzips so you can `cmp` the gzip vs identity body.
- **Measuring a gzip/serialization change** (e.g. P0b): use the **gzip-vs-identity
  TTFB delta** on a WARM hit. The Firestore floor (~1.9s in dev) is common to both,
  so the delta isolates exactly the gzip/serialize CPU. (Pre-P0b slim delta 0.74s →
  post 0.14s; full 1.87s → 0.05s.)
- **Backend timing:** `uvicorn.error` logger emits
  `dashboard.data|share ... cache=HIT/MISS gather_ms=… serialize_ms=…` (both 0 on a
  warm hit; orjson/gzip and Firestore-meta reads are NOT in those splits — that's
  why the warm wall-clock floor isn't visible there).
- **Backend tests** (run from repo root, or set `GCP_PROJECT_ID`; `env_file=.env`
  resolves relative to CWD so `cd api && pytest` misses it and 4 settings-dependent
  tests fail spuriously): venv at `.venv/`. Example:
  `$env:GCP_PROJECT_ID="x"; .venv\Scripts\python -m pytest api/tests -q -k "dashboard or share or report or response"`.
  Two full-suite failures are env-only (missing `.env` / GCP creds in cost-metering).
- **CPU profile (FE):** Playwright MCP (its Chrome is logged in; chrome-devtools MCP
  is blocked from Google sign-in). Open a fresh `browser.newContext()` for the share
  to be unauthenticated.

## Key files
- **P0b (new):** `api/services/dashboard_response.py`, `api/tests/test_dashboard_response_cache.py`,
  `api/main.py` (GZipMiddleware compresslevel).
- BE: `api/services/dashboard_service.py` (DETAIL_FIELDS, slim helpers,
  `get_or_build_core`, `build_dashboard_sql`, `build_dashboard_kpis_sql`),
  `api/services/dashboard_cache.py`, `api/services/report_transform.py`,
  `api/routers/dashboard.py`, `api/routers/dashboard_shares.py`,
  `workers/shared/firestore_client.py`, `workers/shared/bq_client.py`.
- FE: `frontend/src/api/endpoints/dashboard.ts`,
  `frontend/src/features/studio/dashboard/{use-post-details.tsx,
  dashboard-aggregations.ts,embed-posts.ts,use-dashboard-filters.ts,
  SocialWidgetRenderer.tsx,SocialDashboardView.tsx,EmbedPostGallery.tsx,
  SharedDashboardPage.tsx,DashboardView.tsx}`,
  `frontend/src/components/DataTable/ExpandedPostRow.tsx`.

## Related memory / prior art
- `project_dashboard_load_bottleneck` (BQ download + response cache),
  `project_dashboard_warm_cost_gzip` (P0b; gzip-not-orjson; Firestore-floor finding),
  `project_dashboard_fe_filterbar_bottleneck` (FE filter-bar fix),
  `feedback_dashboard_schema_parity` (dual-source enums; run the parity test),
  `feedback_env_sync_prod` (any new env var must land in `deploy_prod.sh` + `deploy.yml`).
- Bug logs: `docs/bugs/api-dashboard-payload-slimming.md` (P0a+P1),
  `docs/bugs/api-dashboard-response-gzip-cache.md` (P0b),
  `docs/bugs/frontend-dashboard-*`, `docs/bugs/api-dashboard-*`.
