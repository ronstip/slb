# api: /dashboard/layouts POST 422 — `customConfig.dimension="custom:<field>"` rejected

## Symptom

In dashboard edit mode, clicking **Done** appeared to do nothing — the button silently failed and edit mode never exited. The frontend swallowed the error in `handleDone`'s `catch {}`.

Network panel (or, after the diagnostic toast was added):

```
POST /api/dashboard/layouts/<artifact_id>  →  422
{"detail":[{
  "type":"literal_error",
  "loc":["body","layout",1,"customConfig","dimension"],
  "msg":"Input should be 'platform', 'sentiment', 'emotion', 'language', 'content_type', 'channel_type', 'channel_handle', 'posted_at', 'themes', 'entities' or 'brands'",
  "input":"custom:reaction_type"
}]}
```

## Repro

1. Add a custom widget to a dashboard whose group-by dimension is an agent-defined enrichment field (rendered in the picker as `custom:<field_name>`).
2. Click **Done**.
3. Request POSTs to `/dashboard/layouts/{artifact_id}` and 422s.

## Root cause

`CustomDimension` is dual-typed:

- Frontend (`frontend/src/features/studio/dashboard/types-social-dashboard.ts:43-55`) is `Literal[...] | \`custom:${string}\`` — standard dimensions plus dynamically-named enrichment fields.
- Backend (`api/routers/dashboard_schema.py:47`) was only the `Literal[...]` set. The template-literal arm has no Python equivalent.

Schema parity test (`api/tests/test_dashboard_schema_parity.py::test_custom_dimension_matches`) compares Python `get_args(CustomDimension)` against TS string literals only — the regex `'([^']+)'` skips the backtick template-literal arm, so the drift was invisible.

## Fix

Commit on branch `dev`: add `CustomFieldDimension = Annotated[str, StringConstraints(pattern=r"^custom:[^\s]+$")]` and `CustomDimensionField = Union[CustomDimension, CustomFieldDimension]`. Switch model fields on `CustomChartConfig`, `CustomTableConfig`, and `TableColumn` from `CustomDimension` → `CustomDimensionField`. `CustomDimension` itself stays the literal so the parity test remains meaningful.

Regression test: `test_custom_config_accepts_custom_field_dimension` in `api/tests/test_dashboard_schema_parity.py` — accepts `custom:reaction_type`, accepts standard literals, rejects unrelated strings.

Also patched `handleDone` in `frontend/src/features/studio/dashboard/SocialDashboardView.tsx` to surface save failures via `toast.error` + `console.error` instead of swallowing — silent `catch {}` is what hid this for a user-visible feature.
