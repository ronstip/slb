# Story Mode: duplicate KPI metrics, unverifiable numbers, lonely-chart packing

Three issues found by inspecting a real persisted story layout
(`dashboard_layouts/b17aaae105204084ad4fb2564b6060e7`) against the render +
verify code. All on branch `DashboardDesign` (uncommitted).

## 1. KPI cards all render the same metric ("3x Total Posts")

**Repro:** run a story; the 3 number-cards showed identical values despite
distinct titles ("Artan Topic Views", "Qatar Contrast Views", ...).

**Root cause:** the cards were persisted as `aggregation:"kpi"`,
`chartType:"number-card"`, `kpiIndex:null` (two also carried
`customConfig.metric`). Renderer dispatch (`SocialWidgetRenderer.tsx`): `agg`
isn't `custom`, so it falls to the `chartType==='number-card'` branch →
`KpiWidget` → `kpis[widget.kpiIndex ?? 0]` = `kpis[0]` = Total Posts for all
three. `KpiWidget` shows the canonical KPI **label** (title ignored) and
`computeEnhancedKpis` reads global `serverKpis` (so kpi-cards can't even be
topic-scoped). `customConfig` is ignored on this path. A scoped/custom-labeled
story KPI must be `aggregation:"custom"` (CustomWidget: metric from
`customConfig.metric` over filtered posts, label = title).

**Fix:**
- Renderer safety net: `normalizeWidgetAggregation` now coerces a number-card
  carrying `customConfig.metric` from `kpi` → `custom`
  (`types-social-dashboard.ts`).
- Lint `_layout_quality_hints` now flags number-cards that resolve to the same
  *effective metric* (kpi: kpiIndex; custom: metric+filter-scope) and flags
  `agg:"kpi"` cards whose `customConfig.metric` is silently ignored.
- Prompt (`story_mode.py`) rewritten to teach the two-card model and steer
  story KPIs to `aggregation:"custom"`.
- Tests: `normalize-widget-aggregation.test.ts`,
  `test_layout_hints_flags_duplicate_metric_kpi_cards`,
  `test_layout_hints_flags_kpi_card_with_ignored_customconfig`.

## 2. Narrative numbers not independently verifiable

**Root cause:** the narrative led with "33.1 million views", "64% negative",
"7.6M views" — none `<fact>`-wrapped, so `verify_story` checked nothing. The
fact grammar couldn't express them: no numeric-column sums (views/engagement)
and no compound/topic-scoped conditions (negative% *within* a topic).

**Fix (`dashboard_report.py`):**
- New metric key `sum:<metric>` (views/likes/comments/shares/saves/engagement).
- New `@dim:value` scope suffix on any fact (e.g.
  `pct:sentiment:negative@topic:<id>`, `sum:views@topic:<id>`), chainable.
- `_parse_fact_value` now accepts human magnitudes ("33.1 million", "7.6M").
- `verify_story` emits a non-fatal `untagged_numbers` nudge when load-bearing
  numbers are stated without a `<fact>` wrapper.
- Prompt documents the extended grammar.
- Tests: `test_fact_metric_sql_supports_sum_*`, `test_split_fact_src_*`,
  `test_fact_scope_predicates_*`, `test_parse_fact_value_handles_human_magnitudes`,
  `test_verify_story_verifies_sum_fact_with_topic_scope`,
  `test_verify_story_verifies_topic_scoped_pct`,
  `test_verify_story_nudges_on_untagged_numbers`.

## 3. Wasted grid space (centered charts + vertical gaps under KPIs)

**Root cause (horizontal):** sections with one chart were centered (`x=3 w=6`,
`x=2 w=8`), leaving dead space on both sides. The old lint only flagged charts ≤
half-width, so the `w=8` case slipped through.

**Root cause (vertical, found in follow-up):** short KPI cards (`h=2`) sharing a
row with a tall chart (`h=8`) left a blank block under the KPIs - and the prompt
forbade full-width charts, so a single-chart section had no gap-free option. The
row-by-row lint couldn't see vertical holes.

**Fix:**
- `_layout_quality_hints` flags lone charts with empty columns on *both* sides
  (centered, any width), and now also counts `_enclosed_gap_cells` - empty cells
  boxed in above *and* below by widgets (the under-KPI block) - and flags ≥4.
- Relaxed the "too wide" rule: a full-width (`w=12`) chart that fills its row is
  now allowed (it kills the gap); only `w=9..11` slivers and wide KPI cards are
  flagged.
- Prompt rewritten to one uniform-row template: headline (`w12`) → KPI row
  (cards summing to 12 at `h=2`) → chart row (two `w6` charts or one `w12`),
  never mixing KPI + chart in a row; `verify_story` must report empty
  `layout_hints` before finishing.
- Text widgets now start at `h=2` and auto-fit grows to exact content (no
  internal whitespace). See
  [frontend-dashboard-grid-infinite-update-loop.md](frontend-dashboard-grid-infinite-update-loop.md)
  for the related grid crash fixed at the same time.

**Tests:** `test_layout_hints_flags_centered_lone_chart`,
`test_layout_hints_flags_centered_wide_lone_chart`,
`test_layout_hints_allows_left_aligned_wide_lone_chart`,
`test_layout_hints_flags_vertical_gap_under_kpis`,
`test_layout_hints_no_vertical_gap_when_rows_uniform_height`,
`test_enclosed_gap_cells_counts_only_sandwiched_holes`,
`test_layout_hints_allows_full_width_chart_filling_row`,
`test_layout_hints_flags_almost_full_chart_sliver`.

**Verified live:** re-ran the story end-to-end on a real dashboard - final
layout had `_enclosed_gap_cells == 0`, `layout_hints` clean, KPI rows filling 12
cols with full-width charts below, no crash.

## Verification

`api/tests/test_report_editor_mode.py` (48) + dashboard_report dependents (9)
green; FE `normalize-widget-aggregation` / `story-mode` / `topic-filter` /
`Markdown.fact-tags` green; `npx tsc --noEmit` clean.
