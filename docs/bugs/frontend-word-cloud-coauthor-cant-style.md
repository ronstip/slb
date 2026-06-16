# Co-author AI can't recolor/rename word-cloud words (reports success, no change)

## Symptom
The co-author AI can recolor/rename categories on bar/pie/line widgets but not
on the word-cloud widget. It even replies that it changed them, yet nothing
changes. (The Style tab also silently failed to recolor words.)

## Root cause — TWO gaps, both required
1. **Render side ignored overrides.** `ThemeCloud.tsx` never read
   `styleOverrides.seriesColors` / `seriesLabels` — it colored words from the
   global categorical palette (`useChartColors`) and rendered raw `word.text`.
   So ANY override (AI, Style tab, or report-level value colors) was a no-op.
   The sub-agent investigation initially missed this — fixing only the context
   side would have let the AI emit a `seriesColors` map the renderer still drops.
2. **Context side hid the labels.** `widget-labels.ts` excluded `word-cloud`
   from `NON_SERIES_CHART_TYPES` and from `getWidgetRenamableLabels`, and
   `widgetData()` had no `theme-cloud` case → the co-author context (and the
   Style-tab per-series picker) got empty label lists, so the AI had no exact
   keys to build a valid `seriesColors`/`seriesLabels` map.

The AI's "success" was real at the API layer (patch accepted, persisted) but the
keys matched nothing renderable → invisible.

## Fix
- `ThemeCloud.tsx`: accept `seriesColors` / `seriesLabels` props; `color =
  seriesColors[word.text] ?? palette`, `display = seriesLabels[word.text] ??
  word.text`. Raw text still drives color lookup, click-to-filter, tooltip key.
- `SocialWordCloudWidget.tsx` + both render sites in `SocialWidgetRenderer.tsx`:
  thread `widget.styleOverrides.seriesColors/seriesLabels` through. (Report-level
  value colors, already baked into `seriesColors`, now apply to word clouds too.)
- `widget-labels.ts`: drop `word-cloud` from the exclusions; add a `theme-cloud`
  case mapping `aggregateThemeCloud` → word labels.
- `SocialWidgetConfigDialog.tsx` (StyleTab): for word-cloud, compute series
  labels from `aggregateThemeCloud` so the per-word color/rename picker renders.

## Regression tests
- `frontend/src/features/studio/dashboard/widget-labels.test.ts` — word-cloud
  exposes theme words as colorable + renamable labels.
- (Render override path covered by existing studio suite + manual verify.)

## Commit
Branch `dev`, not yet committed.
