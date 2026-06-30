# frontend: HTML marketing widgets squashed / dead space on mobile shared dashboards

## Repro

1. Open a marketing shared dashboard with `aggregation: 'html'` widgets
   (e.g. `/shared/wc26brands`) on a narrow viewport (≤ ~600px).
2. Observe:
   - **Section dividers** (a thin "THE ANALYSIS" line, designed `h: 2`) render
     in a ~234px cell with a huge dead gap below.
   - **Reflowing snippets** (the 3-up modality cards, the "We never blink"
     radar, the alert chat) are crammed: content is shrunk to `zoom: 0.43–0.69`
     to fit a cell sized from the desktop row count.

## Root cause

HTML marketing snippets carry `manualHeight: true` (the author hand-sized them
on desktop, which enables `HtmlWidget`'s zoom-to-fit). Two things compounded on
mobile:

- `buildCompactLayout` floored every non-text widget to a **4-row minimum**, so a
  designed `h: 2` divider became a 234px cell. Zoom-to-fit only ever *shrinks*
  (never enlarges), so the extra rows showed as dead space.
- On a narrow viewport the snippets reflow their own internal layout to a single
  column, so their content gets **taller** than the desktop-authored cell.
  Zoom-to-fit then shrank that taller content to cram it back into the small
  cell → squashed cards.

Measured live at 390px before the fix: modality `cellH 420 / naturalH 845 /
zoom 0.43`; "never blink" `234 / 317 / 0.69`; dividers `234px` cell for `108px`
of content.

## Fix (branch: dev, uncommitted at time of writing)

1. **`SocialWidgetRenderer.tsx` (`HtmlWidget`)** — new `compact` prop (true on
   non-lg breakpoints). When compact, the widget **auto-sizes** to its reflowed
   content (the auto-size effect now runs even with `manualHeight: true`) and the
   **zoom-to-fit effect is skipped** (it would fight the auto-size by shrinking
   the taller mobile layout back into the stale cell).
2. **`SocialDashboardGrid.tsx`** — derives `compact = currentBreakpoint !== 'lg'`
   and passes it down. Crucially, mobile auto-size measurements are routed to a
   **local `compactHeights` map**, *not* the shared `widget.h`. Writing them to
   `widget.h` (the original instinct) corrupted the desktop layout: after a
   mobile→desktop resize the cell stayed mobile-tall, and an edit could persist
   it. The lg layout always uses the authored `h`.
3. **`buildCompactLayout.ts`** — html widgets no longer floored to 4 rows
   (use designed `h`, min 2, like text/embed); accepts `heightOverrides` so the
   compact layout packs around the measured `compactHeights`.
4. **Snippet polish** (Firestore `dashboard_layouts/6f95…`, the live shared doc):
   modality cards got a fixed taller media (190px) so the row stretches the text
   tile to match (no more empty text card), a redesigned result box (icon +
   headline + "combined reach" stat), and `w17` cell `h: 7 → 8`. Hero + "never
   blink" got tighter mobile padding via `@media(max-width:680px)`.

## Verified

- Live at 390px: every html widget `zoom: 1`, cell ≈ content (dividers 110px,
  modality full-size, "never blink" stacks cleanly).
- Desktop unchanged (authored heights, zoom-to-fit) — and a
  desktop→mobile→desktop resize no longer corrupts the desktop heights.
- `npm run build` clean; `vitest run src/features/studio/dashboard` 274 passed
  (incl. new `buildCompactLayout.test.ts`).

## Follow-ups (same session)

- **Mobile row-quantization gap (hero).** With zoom-to-fit off on mobile, a
  snippet whose natural height isn't a multiple of the 62px row pitch rounds
  *up* a row, and the auto-size shrink dead-band (`delta <= -2`) wouldn't trim a
  single excess row → the hero showed ~44px of dead space at the bottom. Fix:
  the dead-band is now `compact ? -1 : -2` (a height-only cell change can't
  reflow content width, and compact heights are local/disposable, so trimming
  one row on mobile is safe). Hero mobile padding was also tightened so it lands
  cleanly on a row boundary.
- **Top-of-hero spacing.** Reduced via the hero snippet's mobile padding-top and
  by tightening the shared-page header's bottom margin on mobile only
  (`SharePageDefinitionRow.tsx`: `mb-6` → `mb-3 sm:mb-6`; desktop unchanged).
- **Modality TEXT card split sentence.** Making `.cap` a flexbox to vertically
  centre it laid its inline text + the `adidas` highlight chip out as
  side-by-side flex items (a gap mid-sentence). Fix: `.cap` stays a normal text
  block; the parent `.body` does the vertical centring (`justify-content:center`).

## Regression test

`frontend/src/features/studio/dashboard/buildCompactLayout.test.ts` — covers the
height-floor change. The `HtmlWidget` compact auto-size / zoom-skip behaviour
relies on ResizeObserver + Shadow DOM + CSS zoom (not supported in jsdom), so it
is verified manually via Playwright at mobile + desktop widths.
