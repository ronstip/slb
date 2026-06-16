# api — donut center label (and value-label display) not persisted

## Repro
1. Edit a doughnut widget → Style tab → set the center label ("Text shown inside
   the donut, above the total").
2. Save, then refresh the dashboard.
3. Center label is gone; falls back to the metric name.

## Root cause
Backend `ChartStyleOverrides` in `api/routers/dashboard_schema.py` uses
`model_config = ConfigDict(extra="ignore")` but only declared `accent`,
`seriesColors`, `seriesLabels`. The newer `centerLabel` and `labelDisplay`
fields (added frontend-side in commits e4c4aed / 0b1b81f) were undeclared, so
Pydantic silently dropped them on save. The values never reached Firestore →
vanished on the next read.

## Fix
Declared `labelDisplay: str | None` and `centerLabel: str | None` on
`ChartStyleOverrides`. `labelDisplay` kept as loose `str` so the
`'abs'|'pct'|'abs_pct'|'none'` Literal stays validated client-side.

## Regression test
`api/tests/test_chart_style_overrides_roundtrip.py` — round-trips both fields
through `model_validate` + `model_dump`.

## Lesson
Any frontend field stored under a backend model with `extra="ignore"` MUST be
declared on that model or it's silently dropped. When adding a styleOverrides
field, mirror it in `dashboard_schema.py`.

## Fix commit
(uncommitted — branch `dev`)
