# Dashboard crash: `Cannot read properties of undefined (reading 'startsWith')`

## Symptom

Production users opening a saved explorer dashboard hit a full-page error:

```
TypeError: Cannot read properties of undefined (reading 'startsWith')
  at j (separator-*.js)        ← isCustomFieldDimension
  at x (separator-*.js)        ← getDimensionKeys / getDimensionMeta
  at Jt (separator-*.js)       ← aggregateCustom
  at useMemo in SocialDashboardView chunk
```

URL pattern: `/agents/<id>?tab=explorer&layout=<layout_id>`

Did not repro on localhost — bug is data-dependent. Saved layout JSON in
Firestore could contain a widget config where `dimension` is undefined but the
code path still reaches `isCustomFieldDimension(dim)` (e.g. malformed table
column with `kind: 'dimension'` but no `dimension`, or a custom aggregation
config produced by an older agent / migration gap).

## Root cause

`isCustomFieldDimension(dim)` in
[frontend/src/features/studio/dashboard/types-social-dashboard.ts](../../frontend/src/features/studio/dashboard/types-social-dashboard.ts)
called `dim.startsWith(CUSTOM_DIM_PREFIX)` directly. Type signature claimed
`dim: CustomDimension`, but in practice production data fed it `undefined`,
crashing the whole dashboard render via the `useMemo` chain in
`SocialWidgetRenderer` → `aggregateCustom` → `getDimensionKeys` →
`isCustomFieldDimension`.

`getDimensionMeta(dim)` had the same shape and would also crash (called from
`autoColumnHeader`, `SocialWidgetConfigDialog`, `DataSourceForm`,
`TableDataForm`).

## Fix

- Defensive guard in `isCustomFieldDimension`: `typeof dim === 'string' && dim.startsWith(...)`.
- `getDimensionMeta` returns an `UNKNOWN_DIMENSION_META` fallback for
  undefined/null/unknown dims instead of returning `undefined`.

The fix is a containment patch: a single bad widget no longer takes down the
whole dashboard. It does not address the upstream data quality issue — saved
layouts can still ship a widget with `dimension: undefined`, but that widget
will now render an "Unknown" label / empty data instead of crashing the page.

## Regression test

[frontend/src/features/studio/dashboard/types-social-dashboard.test.ts](../../frontend/src/features/studio/dashboard/types-social-dashboard.test.ts)
covers the undefined/null inputs that reproduced the crash before the fix.

## Follow-up worth considering

- Audit `dashboard-aggregations.ts` for any other `dim`/`dimension` access
  past the `if (!dimension)` early return — if a widget arrives with
  `dimension` set to an invalid string the chart will render "Unknown" buckets
  rather than nothing, which may surprise the user.
- Consider a migration / validator that strips `kind: 'dimension'` columns
  with no `dimension` field at load time so the renderer never sees them.
