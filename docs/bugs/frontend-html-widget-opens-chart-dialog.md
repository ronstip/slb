# frontend — HTML widget opened the chart config dialog instead of the HTML editor

## Symptom
Adding a new "HTML / Embed" widget opened the **same chart "Add Widget" modal**
(Data / Filters / Style tabs) as a custom chart, not the HTML code editor. The
config dialog's `isHtmlMode` branch never matched.

## Repro
1. Edit a dashboard → Add Widget → HTML / Embed.
2. Dialog opens with chart Data/Filters/Style tabs (wrong) instead of the HTML
   textarea + live preview.

## Root cause
`SocialWidgetConfigDialog` seeds its draft via `toCustomDraft(widget)`
(`frontend/src/features/studio/dashboard/widget-config/SocialWidgetConfigDialog.tsx`).
That helper passes `text`/`embeds`/`media` through untouched but coerces **every
other** aggregation to `aggregation: 'custom'`. The new `html` aggregation fell
into the coercion, so by the time the dialog read `draft.aggregation` it was
`'custom'` → the chart config UI. The new `html` editor branch was correct but
unreachable.

This was a gap in the original plan: adding a content aggregation requires a
passthrough in `toCustomDraft`, in addition to the union / `AddWidgetKind` /
`handleOpenAdd` / dialog-branch changes.

## Fix
Add `if (widget.aggregation === 'html') return widget;` to `toCustomDraft`
(alongside text/embeds/media). Exported the function and added a regression test
(`widget-config/toCustomDraft.test.ts`) asserting all content widgets pass
through and a chart preset still coerces to `custom`.

## Verified
- `toCustomDraft.test.ts` (6 tests) green.
- Live: Add Widget → HTML / Embed now opens the HTML editor; snippet renders in
  the grid (Shadow DOM, `<style>`/@keyframes kept, no `<script>`), in view mode,
  and in the in-dialog preview.

Fix branch: feat/shared-dashboard-marketing (uncommitted at time of writing).
