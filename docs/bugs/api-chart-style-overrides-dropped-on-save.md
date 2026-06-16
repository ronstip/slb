# api — chart style overrides silently dropped on save

## Symptom
Donut/pie **Slice Labels** (and **Word-cloud Size**) configured in the widget
Style tab disappeared on page refresh and never showed in shared dashboards.
The UI set them and they rendered live, but they didn't survive a reload.

## Repro
1. Open a dashboard, edit a doughnut widget → Style → set **Slice Labels** = Name.
2. Slices show names. Save (Done) → refresh the page.
3. Slice labels are gone; the setting reverted to None. Same for word-cloud Size.

## Root cause
The backend Pydantic model `ChartStyleOverrides`
([api/routers/dashboard_schema.py](../../api/routers/dashboard_schema.py)) uses
`model_config = ConfigDict(extra="ignore")` with an **explicit field whitelist**.
The frontend persists the whole `styleOverrides` object, but on save the backend
validates it and drops any field not declared on the model. `sliceLabelDisplay`
and `wordCloudScale` were never added, so they were stripped before Firestore —
hence absent on load and in the share endpoint (which serves the raw persisted
layout). This is a recurring class of bug (previously hit `labelDisplay`,
`centerLabel`, `xAxis`/`yAxis`).

The frontend/render/save/load/share wiring was all correct — only the schema
declaration was missing.

## Fix
- Declared `sliceLabelDisplay: str | None` and `wordCloudScale: float | None` on
  `ChartStyleOverrides`.
- Added a **parity guard** so this can't recur silently: a test extracts the
  frontend `ChartStyleOverrides` interface fields and asserts every one is
  declared on the backend model.

## Regression tests
- [api/tests/test_chart_style_overrides_roundtrip.py](../../api/tests/test_chart_style_overrides_roundtrip.py) —
  `test_slice_label_display_round_trips`, `test_word_cloud_scale_round_trips`.
- [api/tests/test_dashboard_schema_parity.py](../../api/tests/test_dashboard_schema_parity.py) —
  `test_chart_style_overrides_fields_declared_in_backend` (drift guard).

## Lesson for future changes
When adding a persisted widget/style field, wire it through the **whole** data
path, not just the UI: frontend type → backend Pydantic schema (or it's dropped
by `extra="ignore"`) → confirm it survives the share/Brief endpoint. The parity
test now enforces the frontend↔backend half automatically.

## Fix commit
Branch `dev` (uncommitted at time of writing).
