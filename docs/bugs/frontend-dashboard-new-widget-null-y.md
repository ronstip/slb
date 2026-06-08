# frontend — new text card / widget save fails with `y: null`

## Symptom
Creating a new text card (or any widget) in the modular dashboard editor → backend 422:

```json
{"detail":[{"type":"int_type","loc":["body","layout",15,"y"],"msg":"Input should be a valid integer","input":null}]}
```

## Repro
1. Enter dashboard edit mode.
2. Add a text card / widget via the config dialog (or duplicate one).
3. Save fires immediately → 422.

## Root cause
New widgets are created with `y: Infinity` as a react-grid-layout "append to bottom"
hint (`handleOpenAdd` / `handleDuplicateWidget` in `SocialDashboardView.tsx`). The grid
resolves it to a concrete row on its next layout pass, but immediate saves
(`handleSaveWidget`, duplicate auto-save) fire before that pass. `JSON.stringify(Infinity)`
serializes to `null`, and the backend model `SocialDashboardWidget.y: int = Field(ge=0)`
(`api/routers/dashboard_schema.py`) rejects it.

## Fix
Normalize the layout at the single save chokepoint — the `mutationFn` in
`useSaveDashboardLayout` (`frontend/src/features/studio/dashboard/hooks/useDashboardLayout.ts`).
`normalizeLayoutForSave` packs any non-finite `y` to the bottom of the finite widgets
(stacking multiple), and coerces non-finite `x` to 0. Covers all save paths
(autosave, done, config-dialog add, duplicate).

## Regression test
`frontend/src/features/studio/dashboard/hooks/useDashboardLayout.test.ts`

## Commit
Not yet committed — branch `dev`.
