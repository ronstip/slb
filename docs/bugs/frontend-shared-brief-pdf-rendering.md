# frontend — shared brief PDF rendering

## Symptoms

Downloading `/shared/<token>` as PDF (`exportDashboardPdf`) produced four
visible defects, all in the same render path:

1. **Tables show ellipsized junk** — e.g. topic column with single Hebrew char
   `ת`, channel handles like `@RonenMane…`, post-type chips like `re…`.
2. **Column widths cramped** — same root cause as (1): `table-fixed` with
   `w-[8%]`/`w-[11%]` etc. + cell `truncate`/`overflow-hidden`.
3. **Header date was always "today"** — `new Date()` at export time, not the
   brief's `meta.created_at`.
4. **Embedded post widgets were blank** — third-party iframes (X, YouTube, FB,
   LinkedIn) don't capture in `html2canvas`.

## Root cause

`frontend/src/features/studio/dashboard/exportDashboardPdf.ts` rasterizes the
live DOM with html2canvas-pro. The shared page is rendered at `max-w-6xl`, so
the table cells are narrow and ellipsis-baked-in. The screenshot is then
shrunk to the A4 content width, so the truncation cannot recover. iframes
never render to canvas at all. The date in the cream chrome band was sourced
from system time, not the brief's generation time.

## Fix

- `exportDashboardPdf` now takes an optional `generatedAt: string | null` and
  uses it for the header `dateStr`. Falls back to `new Date()` when missing
  (editor / legacy callers).
- `useSharePageActions` accepts and forwards `generatedAt`. All three shared
  pages (`SharedDashboardPage`, `SharedArtifactPage`, `SharedBriefingPage`)
  pass `data.meta.created_at`.
- New `applyPdfCaptureStyles` injects a capture-only stylesheet (toggled by
  `.pdf-capturing` on the grid root) that flips tables to `table-auto`,
  removes `truncate`/`overflow-hidden`/`max-w-*` so cells wrap instead of
  ellipsizing.
- New `swapEmbedWidgets` replaces the inner HTML of every
  `[data-embed-widget]` element with a short placeholder during capture, then
  restores it. `EmbedsWidget` (`SocialWidgetRenderer.tsx`) now carries
  `data-embed-widget="1"` on its content div.

## Files

- `frontend/src/features/studio/dashboard/exportDashboardPdf.ts`
- `frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx`
- `frontend/src/lib/share-actions.ts`
- `frontend/src/features/studio/dashboard/SharedDashboardPage.tsx`
- `frontend/src/features/artifacts/SharedArtifactPage.tsx`
- `frontend/src/features/briefings/SharedBriefingPage.tsx`

## Regression test

Manual: open `/shared/<token>`, click Download. Verify header date matches
the brief's creation date (not today), tables show full handles/topics,
embed widgets render as a one-line placeholder rather than blank space.

## Commit

(uncommitted at time of writing — branch `dev`)
