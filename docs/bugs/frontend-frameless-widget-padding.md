# frontend — frameless widgets keep inner padding / phantom gaps when container is off

## Symptom
Turning OFF a widget's "container" toggle left visible outer padding so content
didn't use the full cell and didn't line up with neighbouring widgets:
- HTML widget: phantom strip on the **right** + gap on the **bottom** (left/top fine).
- Media/image widget: empty space on **both sides**.
- Many framed widgets (charts/tables/lists): content stayed inset by ~15px.

## Root cause
Two layers each only dropped the *chrome* (border/shadow/fill) when frameless,
not the spacing:
1. `SocialWidgetFrame` always applied `px-[15px] pb-[15px] pt-[2px]` content
   padding + `px-[15px]` header padding regardless of `containerHidden` →
   charts/tables/lists and media-with-figure stayed inset.
2. The frameless text/html scroll wrapper kept `[scrollbar-gutter:stable]`
   (reserved scrollbar strip on the right with no padding to hide it) and used
   `BOTTOM_PAD_PX = 24` in auto-size, which rounded the cell UP to a spurious
   extra 62px grid row → bottom gap.

## Fix
Made "container off" mean true full-bleed (content flush to the cell edge,
matching the already-flush left/top of html/text). Decisions extracted into
testable helpers in `frontend/src/features/studio/dashboard/widget-container.ts`:
- `frameContentPadding(containerHidden, override?)` → `p-0` when hidden.
- `frameHeaderPaddingX(containerHidden)` → `px-0` when hidden.
- `cardScrollWrapperClass(boxed)` → drops the gutter + padding when frameless
  (the auto-size dead-band already guards oscillation).
- `autoSizeBottomPadPx(boxed)` → `8` frameless (was `24`), `60` boxed.
Wired into `SocialWidgetFrame.tsx` (header + content) and the Text/Html widgets
in `SocialWidgetRenderer.tsx`.

## Regression test
`frontend/src/features/studio/dashboard/widget-container.test.ts` — pins all four
helpers' boxed vs frameless outputs.

## Follow-up: container toggle didn't persist (reverted on refresh)
**Symptom:** turning the container OFF, saving, and refreshing brought the
container back.
**Root cause:** `SocialDashboardWidget` (api/routers/dashboard_schema.py) uses
`ConfigDict(extra="ignore")`, so any widget field not *declared* on the model is
silently dropped on save. `showContainer` was never declared → stripped on every
save → reverted on reload (and never reached shared/Brief boards). Same class of
bug as figureText/manualHeight/media/htmlContent before it.
**Fix:** declared `showContainer: bool | None` on the model.
**Regression test:** `api/tests/test_dashboard_schema_parity.py::
test_widget_round_trip_preserves_show_container` (asserts explicit `False`
round-trips through validate + `model_dump`). `recognized = set(model_fields)` in
`dashboard_report.py` is dynamic, so the agent patch path picks it up too.

## Notes
- Media with `fit: contain` still letterboxes when the image aspect ≠ cell aspect;
  that's the contain behaviour (lever: switch fit to `cover`), not padding.
- Console noise seen alongside this (unrelated, pre-existing): RGL
  `getMaximumSize`/`getComputedStyle` null read while the config dialog mounts
  over the grid, and a Radix `aria-describedby` warning on the config
  `DialogContent` (missing `Description`). Neither blocks the fix.

## Fix commit
Branch `feat/shared-dashboard-marketing` (uncommitted at time of writing).
