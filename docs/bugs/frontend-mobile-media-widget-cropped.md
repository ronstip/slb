# frontend — media widget cropped/distorted on mobile

## Symptom
On the shared dashboard at narrow (mobile) widths, the image/video (media) widget
looked "completely off": a wide 4:1 banner (e.g. FIFA 1958×490) was crushed into a
near-square box and `object-cover` cropped out almost everything, showing only a
meaningless centre slice. The rest of the mobile layout was otherwise stacking
acceptably.

## Repro
1. Open a shared dashboard containing a media widget with a wide banner image.
2. View at ≤480px (the `sm`/`xs` react-grid-layout breakpoints).
3. Media cell keeps the desktop row count → box aspect ~1.5:1 vs image 4:1 → cover-crop.

## Root cause
`buildCompactLayout` stacked every non-KPI widget full-width while **reusing the
desktop `widget.h` row count** (`Math.max(w.h, minH)`). For charts that's fine
(responsive height), but a media cell's box then has a totally different aspect
ratio than on desktop, and `object-cover` crops the image hard. The grid never
knew the media's intrinsic aspect ratio.

## Fix
Make the compact (mobile) layout size media cells to the media's own aspect ratio:
- `MediaWidget` reports its intrinsic ratio (img `naturalWidth/Height`, video
  `videoWidth/Height`) via a new `onMediaAspect(id, ratio)` callback (mirrors the
  existing `onAutoSize` plumbing through `SocialWidgetRenderer`).
- `SocialDashboardGrid` holds a `mediaAspect` map (jitter-guarded so a reload can't
  churn the layout) and passes it + the measured full-width px into
  `buildCompactLayout` via a new optional `CompactLayoutOptions` arg.
- `buildCompactLayout` derives the media cell row count from
  `fullWidthPx / aspect` (+1 row each for header/caption when present), clamped
  [2,16]. Falls back to the previous `max(w.h,2)` until the aspect is measured.
- Desktop (`lg`) layout is untouched — manual editor sizing is preserved.

Result: mobile media cell went from ~1.49:1 (severe crop) to ~3.16:1, matching the
4:1 banner; the whole banner (trophy + logo) is now visible.

## Regression tests
`frontend/src/features/studio/dashboard/SocialDashboardGrid.test.ts`:
- "sizes a media cell to its aspect ratio on compact, not the desktop height"
- "falls back to the desktop height for media until its aspect is known"

## Note
The "Maximum update depth exceeded" errors seen mid-development were an HMR artifact
from editing the live page; a fresh navigation shows no loop (verified desktop+mobile).

## Fix
Branch `DashboardDesign`, not yet committed at time of writing.
Files: `buildCompactLayout.ts`, `SocialDashboardGrid.tsx`, `SocialWidgetRenderer.tsx`.
