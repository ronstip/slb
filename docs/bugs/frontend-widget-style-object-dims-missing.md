# frontend — widget Style tab missing object dimension values

## Symptom
Dashboard widget → edit → widget configured with a `list[object]` field (rows =
object elements) → **Style** tab: the dimension (per-series / rename) values are
absent. Nothing to recolor or rename.

## Root cause
`StyleTab` in
[SocialWidgetConfigDialog.tsx](../../frontend/src/features/studio/dashboard/widget-config/SocialWidgetConfigDialog.tsx)
computed its preview data with only the post/topic aggregators
(`aggregateCustom` for charts, `aggregateTable` for tables). Neither handles
`list[object]` element-as-unit fields, so the aggregation returned empty
labels → `extractChartSeriesLabels` / table `dimGroups` produced nothing →
ChartStyleEditor / TableStyleForm rendered no dimension values.

`SocialWidgetRenderer.tsx` already routed objects correctly (via
`objectFieldOf` → `aggregateObjectList`, `objectFieldOfTable` →
`aggregateObjectTable`); the Style tab just never mirrored that branch.

## Fix
Added the object routing to both `StyleTab` branches:
- Chart branch: `objectFieldOf(customConfig)` → `aggregateObjectList`.
- Table branch: `objectFieldOfTable(tableConfig)` → `aggregateObjectTable`.

`getDimensionMeta` already labels object dims, so the existing dimGroup /
series-label code works once fed the right rows.

## Tests
No component-test framework on this surface (vitest env = `node`, no jsdom).
Underlying object aggregators are covered by
`object-list-aggregations.test.ts`. Verified via `npx tsc --noEmit`.

## Fix commit
Branch `dev`, uncommitted at time of writing.
