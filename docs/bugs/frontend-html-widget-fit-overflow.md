# frontend: HTML widget — scrollbar / dead space when manually resized

## Repro

1. Create an HTML widget with a fixed-height marketing banner snippet.
2. Let auto-size fire once (grid height snaps to content).
3. Manually drag the resize handle: one row shorter → scrollbar appears;
   one row taller → dead space at the bottom.
4. There is no intermediate grid height that fits perfectly.

## Root cause

Grid rows are 62 px each (48 px rowHeight + 14 px margin). The HTML content's
natural pixel height rarely lands on an exact multiple of 62 px. Once the user
manually resizes (`manualHeight = true`), auto-size is disabled and the grid
snap forces a height that either clips content (scrollbar) or leaves dead space
(up to ~60 px per row).

Two additional symptoms contributed:

- `overflow-y: auto` on the scroll wrapper showed a scrollbar the instant
  content overflowed by even 1 px.
- The auto-size shrink dead-band (`delta <= -2`) could leave the widget one
  row taller than needed even in auto-size mode.

## Fix (branch: feat/shared-dashboard-marketing)

`SocialWidgetRenderer.tsx` — `HtmlWidget` component:

1. **`overflow: hidden`** replaces `overflow-y: auto` on the scroll wrapper.
   No scrollbar ever shows; slight overflow is cleanly clipped until auto-size
   converges. Removes the phantom scrollbar-gutter strip on the right side.

2. **Zoom-to-fit** when `manualHeight = true`: a `useEffect` observes the
   wrapper container's `clientHeight` via `ResizeObserver`. On each observation
   it resets `host.style.zoom = ''`, reads `host.scrollHeight` (forced sync
   reflow), computes `zoom = containerH / naturalH`, and applies it together
   with `width = (100 / zoom)%` so the content still fills the full cell width.
   CSS `zoom` is layout-aware (unlike `transform: scale`), so the host's layout
   box matches the visual box — no dead space, no scrollbar. The observer is
   attached to the CONTAINER (not the host), avoiding a feedback loop.

## No regression test

Shadow DOM, ResizeObserver, and CSS zoom are not supported in jsdom. The
behaviour is verified manually: resize the HTML widget in edit mode and observe
that the content scales to fill each grid height without scrollbar or dead space.

## Follow-up: dead strip on the RIGHT after editing the snippet

**Symptom:** after editing an HTML widget's code (e.g. the `wc26brands` hero),
the content stopped filling the cell width — a white strip appeared on the right.

**Root cause:** the zoom-to-fit `applyZoom` measures `host.scrollHeight` once,
then sets `width:(100/zoom)%` to compensate. Marketing snippets use custom fonts
(`Fraunces` / `Inter Tight`); the first measurement after an edit runs with the
fallback font, so `naturalH` — and the derived `width` — are computed against the
wrong metrics. When the font swaps in, the host reflows but the ONLY observer was
on the *container* (the grid cell, whose size never changes), so `applyZoom`
never re-ran → the stale `width` left the gap. Same class of staleness hit late
`<img>` loads inside the snippet.

**Fix (`SocialWidgetRenderer.tsx`, `HtmlWidget` zoom effect):** also re-run
`applyZoom` on `document.fonts.ready`, on shadow-DOM mutations
(`MutationObserver` on the shadow root), and on two trailing timeouts (250 ms /
700 ms) for async media. All paths are idempotent (applyZoom resets then
recomputes); the MutationObserver only watches the shadow root while applyZoom
mutates the light-DOM host style, so there is no feedback loop. Typecheck:
`tsc -p tsconfig.app.json` clean.

## Follow-up 2: the width compensation was the bug — dead strip on EVERY widget

**Symptom:** every HTML widget whose content already fit its cell rendered ~75–90%
wide with a dead strip on the right (the wider the cell-vs-content ratio, the
bigger the strip). Measured live: a hero at `zoom:1.354` had `width:73.86%` and a
346 px right gap on a 1324 px cell.

**Root cause:** the `zoom > 1` (enlarge) branch was simply wrong. CSS `zoom`
scales the *rendered content* but does NOT widen the host's layout box, and the
companion `width:(100/zoom)%` actively *narrowed* it. So the box ended up at
`(100/zoom)%` with no compensating scale-up → permanent right gap. (The original
"verified manually" note only ever exercised the shrink direction.)

**Fix:** never enlarge. `ratio = containerH / naturalH`; apply `zoom = ratio`
only when `ratio < 0.985` (shrink tall content so it doesn't clip); otherwise
leave `zoom`/`width` unset so the host keeps its natural **100% width**. The
broken `width:(100/zoom)%` companion is removed entirely. Cells are then sized to
the content height (see `dashboard_layouts` doc) so there's no vertical gap
either. Net: HTML widgets fill the full cell width with `zoom:1`. Verified live
(right gap = 0 on all 7 HTML widgets); typecheck clean.
