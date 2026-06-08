# Co-author "recolor widget" silently does nothing

## Symptom
In the dashboard co-author (mode `report_editor`), asking "choose nice color palettes" / "make a rainbow palette" returns a confident success ("Applied a rainbow palette to the breakdown chart") but the widget — and every widget — is visually unchanged.

## Repro
1. Open a dashboard → **Co-author AI**.
2. Pin a widget (or not) and ask "please make a rainbow color palette".
3. Agent says it applied changes. Grid shows no change.

## Root cause
Three compounding gaps:
1. **Silent field drop.** `SocialDashboardWidget` (`api/routers/dashboard_schema.py`) is `model_config = ConfigDict(extra="ignore")`. The agent patched invented field names (`colors`, `palette`, `colorScheme`) that aren't in the schema, so Pydantic dropped them on persist. The layout round-tripped unchanged, `update_dashboard` returned `status: success`, and the agent reported success → no visual change.
2. **Prompt never taught the real fields.** `report_editor_prompt.py` listed only `title`/`figureText`/`description` as safe edits — never the actual color levers (`accent`, `styleOverrides`). So the model guessed field names.
3. **Dead tool reference.** The prompt's grounding section pointed at `execute_sql`, which isn't registered anywhere (no profile has it). The only real grounding tool in `report_editor` is `list_topics`.

Color model reality (frontend `SocialChartWidget.tsx`): `accent` (single hex) → `getAccentColors(accent, 15)` monochrome shades; `styleOverrides.seriesColors` (map of **exact raw label**→hex, case-sensitive) → per-category colors. Only **sentiment** has knowable fixed labels (`positive/neutral/negative/mixed`); other dimensions are data-derived, and there's no tool to fetch labels — so true per-slice rainbow on an arbitrary chart isn't reliably reachable yet.

## Fix
- Teach the two real fields + their exact shapes in `report_editor_prompt.py` (new "Colors & Chart Styling" section); add `accent`/`styleOverrides` to the safe-edits list; remove the dead `execute_sql` reference. Guidance: prefer `accent` (can't miss); use `seriesColors` only when labels are known (sentiment), else use accent or ask.
- `update_dashboard` now surfaces dropped keys: `unrecognized_patch_fields()` collects patch keys not in `SocialDashboardWidget.model_fields`; the result adds `ignored_fields` + a warning so the agent stops falsely succeeding and self-corrects.

## Regression test
`api/tests/test_dashboard_update_unknown_fields.py` — pins `unrecognized_patch_fields` (real fields not flagged; invented color fields flagged).

## Follow-up FIXED: bulk recolor on data-derived labels
Symptom after the first fix: "change the adidas color to blue" worked (user supplied the exact label) but "make it more colorful" did nothing (agent blind to the full brand/platform label list, so it couldn't build a per-slice map). Fix leverages widget pinning: when a chart widget is pinned, the frontend computes its exact rendered category labels and attaches them to the co-author message.
- `frontend/src/features/studio/dashboard/widget-labels.ts` — `getWidgetCategoryLabels(widget, posts, topics)` mirrors SocialWidgetRenderer's two dispatch paths using the same exported aggregators, so labels == the chart's `seriesColors` keys by construction. Test: `widget-labels.test.ts`.
- `coauthor-context.ts` — `AttachedWidget.labels` + `buildCoAuthorMessage` lists them as "exact seriesColors keys"; `SocialDashboardGrid` computes them on pin.
- `report_editor_prompt.py` Colors section — instructed to use provided labels verbatim as `seriesColors` keys.

Still unreachable: a colorful recolor of a chart the user did NOT pin (no labels in context) on a non-sentiment dimension → agent falls back to single accent or asks.

## Follow-up 2: key-MISMATCH no-op (grouped/stacked chart, "change the colors of the values")
Symptom: on a stacked bar (x=channel_type, series=content_type), agent claimed "cleaner palette + relabeled to Fan Vlogs/Official Ads" but the legend stayed lowercase `fan vlog` → its `seriesColors`/`seriesLabels` KEYS didn't match the raw data labels (wrong case / plural / separators).

Verified deterministically (no LLM):
- Backend round-trip is fine: `styleOverrides.seriesColors` with key `"fan vlog"` survives `SocialDashboardWidget` validation + dump (model is camelCase `seriesColors`, no alias).
- Grouped-bar render DOES apply `seriesColors` keyed by the stack-series raw label (`SocialChartWidget.tsx` ~L541). So the only break was the key match.

Fix (deterministic + unit-tested): tolerant override lookup. `frontend/src/features/studio/dashboard/series-overrides.ts` — `makeOverrideResolver()` matches exact key first, then a normalized form (trim + lowercase + collapse `[\s_-]+`). Wired into `SocialChartWidget.resolveSeriesColors` and `displayLabel`, so a near-miss key ("Fan Vlog" → data "fan vlog") still colors/renames instead of silent no-op. Test: `series-overrides.test.ts`. NOTE: plurals ("Fan Vlogs") still won't match by design (no fuzzy/plural stripping — would risk wrong category); the pinned-label delivery + prompt "use labels verbatim" covers that path.

Not verifiable from here: the live agent's actual key output (needs an authed session). Deterministic layers (persist, render, tolerant match, label delivery) are all proven correct.

## Follow-up 2 FIXED: grouped/stacked charts attached ZERO labels
Symptom: pinned a stacked bar (x-axis = channel_type, stacked by brand), asked "color in a nicer palette". Agent claimed "applied a vibrant palette, kept Adidas blue as requested" but only **Nike** recolored.

Root cause (agent-context bug, two layers):
1. `widget-labels.ts` `rawLabels` read only top-level `WidgetData.labels`. A `custom` widget with a `breakdownDimension` returns a *grouped* shape (`groupedCategorical` / `groupedTimeSeries`) with NO top-level `.labels` (see `aggregateCustom` 2D-pivot branch in `dashboard-aggregations.ts:666`). So `getWidgetCategoryLabels` returned `[]` → no "exact seriesColors keys" line in the co-author preamble → agent flew blind and guessed brand names ("Nike" matched by luck; the rest didn't).
2. Even a naive grab of `groupedCategorical.labels` would attach the WRONG keys: for a grouped bar the seriesColors keys are the **dataset/breakdown** labels (brands), not the primary axis labels (channels). Render truth: `SocialChartWidget.tsx:541` keys by `datasets.map(ds => ds.label)`; grouped line keys by `Object.keys(groupedTimeSeries)`; pie/doughnut flatten to `"Primary – Breakdown"` composites.

Fix:
- `widget-labels.ts` — new `seriesColorKeys(data, chartType)` mirrors SocialChartWidget's render branches: grouped time series → series names; grouped categorical bar → dataset labels; grouped categorical pie/doughnut → `"Primary – Breakdown"` composites; else top-level `labels`. The `custom` branch now routes its `WidgetData` through it.
- `report_editor_prompt.py` Colors section — added: never invent category names as `seriesColors` keys (silent no-op still returns success); report only the lever actually used; don't attribute unstated constraints to the user ("kept Adidas blue as requested").

NOT done (infeasible cheaply): backend `update_dashboard` validation of `seriesColors` keys against real labels — the backend has only the Firestore widget config, not the data-derived rendered labels (those are computed frontend-side and injected into the prompt). Would require re-deriving the JS aggregation pipeline in Python.

Regression test: `widget-labels.test.ts` — grouped bar returns brand (series) labels not channel (axis) labels; grouped line returns series names; pie returns composite slice labels.

## Follow-up 3 FIXED: renaming category text + honesty on grouped-chart coloring
Symptom: user asked to improve the COLORS and the TEXT of the x-axis content-type categories on a stacked-by-brand bar. Agent replied "I can't rename the raw category labels" (false) and applied a no-op recolor, claiming success.

Two real capabilities the agent was never told about / never given the keys for:
1. **Renaming is possible** via `styleOverrides.seriesLabels` (raw label → display name). It's rendered through `displayLabel` everywhere — legends, axis ticks, table cells, tooltips (`SocialChartWidget.tsx:548/552`, `SocialWidgetRenderer.tsx` table path). The agent flatly refused because the prompt only documented `seriesColors`.
2. **Color vs rename target different things on a grouped chart.** `seriesColors` tints the stack SERIES (brands); the x-axis categories (content types) are not individually colorable while stacked. But `seriesLabels` can rename BOTH axis categories and series.

Fix:
- `widget-labels.ts` — split into two extractors over a shared `WidgetData`: `getWidgetCategoryLabels` (colorable series, for `seriesColors`) and new `getWidgetRenamableLabels` (axis categories ∪ series, for `seriesLabels`). Mirrors SocialChartWidget's render branches exactly.
- `coauthor-context.ts` — `AttachedWidget.renamableLabels`; `buildCoAuthorMessage` now lists "colorable series (seriesColors keys)" and "renamable labels (seriesLabels keys)" + a rename hint ("you CAN rename data-derived labels"). `SocialDashboardGrid` computes both on pin.
- `report_editor_prompt.py` — new "Renaming Category Text" section (use `seriesLabels`, never claim you can't rename; `styleOverrides` is field-replaced so pass colors+labels together / read first) + "Coloring a Grouped / Stacked Chart" section (colors belong to the series, offer real options, don't fake a no-op).

Regression tests: `widget-labels.test.ts` (renamable bar includes axis + series; single-dim renamable == colorable); `coauthor-context.test.ts` (message lists seriesLabels keys incl. axis categories).

NOTE: not yet verified live via Playwright — the report route is auth-gated and the automation browser needs Google Sign-In. Covered by unit tests; pending an end-to-end check.

## Fix branch
`dev` (uncommitted at time of writing; base SHA 528e011).
