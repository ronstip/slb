# Text card widget height not manually controllable

## Symptom
Dashboard "Text Card" widgets could not be sized manually. Dragging the resize
handle to make a card shorter snapped it straight back to the content height,
leaving an empty band of whitespace the user could not reduce (e.g. a large gap
under a title card). Other widgets (KPI, charts) resized freely.

## Repro
1. Studio dashboard → edit mode → add a Text Card.
2. Grab the resize handle and try to drag it shorter than the rendered markdown.
3. Card snaps back; height is locked to content + padding.

## Root cause
`TextWidget` (and `EmbedsWidget`) in `SocialWidgetRenderer.tsx` run a
`ResizeObserver` auto-fit effect that measures `scrollHeight` and calls
`onAutoSize(i, targetH)` to set the grid row height to the content height on
every layout/content/observer tick. This is good for a freshly-added card (no
clipping, no whitespace) but it continuously overrides any manual resize — the
user can never set a smaller, scrollable height.

## Fix
"Auto-fit until touched": added a `manualHeight?: boolean` flag on
`SocialDashboardWidget`. The auto-fit effect early-returns when
`shouldAutoSizeWidget(widget)` is false. Manual height then sticks; the existing
`overflow-y-auto` wrapper scrolls overflowing content. `minH` lowered so cards
can be squeezed: text → 1 row (a one-line title hugs its row), embeds → 2 rows.
Untouched/legacy cards (`manualHeight` undefined) keep the old auto-fit.

NOTE: the two auto-fit effects (TextWidget + EmbedsWidget) are near-identical;
the guard must be added to BOTH. A copy-paste slip first guarded only the embed
effect, so text cards kept auto-fitting and looked unfixed.

### Two false starts worth remembering
1. Flagging via a separate `setWidgets` on `onResizeStart` (mid-gesture) rebuilds
   the grid's `layouts` prop reference *during* the resize, so RGL aborts the
   gesture and the card snaps back to its original size. Don't call setWidgets
   mid-resize.
2. Flagging via a separate `setWidgets` on `onResizeStop` races the layout
   commit: RGL fires `onResizeStop` then `onLayoutChange` synchronously, and the
   grid's `handleLayoutChange` does a *concrete* `setWidgets(updated)` built from
   the still-stale `widgets` prop — clobbering the flag.

Working approach: `onResizeStop` only records the resized id in a ref
(`pendingResizeId`); the immediately-following `handleLayoutChange` folds
`manualHeight: true` into the *same* `updated` array it commits. One update, no
race, no mid-gesture `layouts` rebuild.

## Regression test
`frontend/src/features/studio/dashboard/text-card-sizing.test.ts`

## Files
- `text-card-sizing.ts` (new) + `.test.ts` — `shouldAutoSizeWidget`
- `types-social-dashboard.ts` — `manualHeight` field
- `SocialWidgetRenderer.tsx` — auto-fit guard (Text + Embed)
- `SocialDashboardGrid.tsx` — `pendingResizeId` ref + `onResizeStop`, folds flag
  into the layout commit; text/embed `minH` 2

## Commit
Not yet committed (branch `dev`).
