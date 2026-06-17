# api: /dashboard/layouts POST 422 - heatmap chartType + cyclical dims rejected

## Symptom

Adding the new **Heatmap** widget surfaced a toast full of raw Pydantic JSON, and
the layout autosave 422'd (visible in console as `POST /dashboard/layouts/<id> → 422`).
The widget still appeared on the grid (local state) but never persisted.

```
{"detail":[
  {"type":"literal_error","loc":["body","layout",6,"chartType"],
   "msg":"Input should be 'bar', ... or 'embed'","input":"heatmap"},
  {"type":"literal_error","loc":["body","layout",6,"customConfig","dimension"],
   "msg":"Input should be 'platform', ... or 'brands'","input":"hour_of_day"},
  ...]}
```

## Repro

1. Add a chart widget, switch chart type to **Heatmap** (seeds `hour_of_day` × `day_of_week`).
2. Autosave POSTs to `/dashboard/layouts/{artifact_id}` and 422s.

## Root cause

Two sources of truth for the dashboard widget schema, enforced by
`api/tests/test_dashboard_schema_parity.py`:

- `frontend/src/features/studio/dashboard/types-social-dashboard.ts`
- `api/routers/dashboard_schema.py`

The heatmap feature added `'heatmap'` to `SocialChartType` and `'hour_of_day'` /
`'day_of_week'` to `CustomDimension` on the **frontend only**. The backend
`Literal[...]` mirrors still rejected them, so every save of a layout containing
a heatmap 422'd.

Secondary: a FastAPI 422 returns `detail` as an **array** of per-field errors (not
the `{error, message}` object our handlers use). `parseError` stringified that
array into the toast → a wall of raw JSON ("really bad UX").

## Fix (branch `GA4`)

Backend schema sync in `api/routers/dashboard_schema.py`:
- `SocialChartType` += `"heatmap"`
- `CustomDimension` += `"hour_of_day"`, `"day_of_week"`
- `VALID_CHART_TYPES["custom"]` += `"heatmap"`

Verified by `test_dashboard_schema_parity.py` (20 passed) - the parity test is the
regression guard; it would have caught this had it been run before shipping the FE.

Error-UX hardening (`frontend/src/lib/`):
- `errors.ts::parseError` - array `detail` no longer dumped as the message; kept on
  `.detail`, message set to `"Some values are invalid."`
- `notify.ts::mapError` - new `case 422` → `"Some of those settings aren't valid and couldn't be saved."`
- Regression test: `frontend/src/lib/errors-validation.test.ts`.

## Note for future-Claude

**Any** new `chartType` / dimension / metric / aggregation added to
`types-social-dashboard.ts` MUST be mirrored in `dashboard_schema.py` (run
`pytest tests/test_dashboard_schema_parity.py`). This is the third 422 of this
exact class - see also `api-dashboard-layout-custom-field-422.md`,
`api-dashboard-object-metric-422.md`.
