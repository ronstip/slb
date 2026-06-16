# Word cloud widget font too big / not adaptive / not styleable

## Symptom
On the Explorer page, the word-cloud widget rendered words huge (e.g. "customer
service" overflowing). Font size did not adapt to the widget container, and the
Edit → Style tab exposed no size control.

## Root cause
`ThemeCloud.tsx` used a hardcoded absolute font range: `fontSize = 12 + normalized * 28`
(12px–40px), independent of container width. Small widgets still hit the 40px max.
The Style tab routes word-cloud through the generic `ChartStyleEditor`, which had
no word-cloud size option.

## Fix
- `ThemeCloud.tsx`: added pure `computeCloudFontRange(width, scale)` — max font
  scales with container width (`width * 0.055`, clamped 16–40px), min = 45% of max.
  Container width measured via `ResizeObserver`. `scale` is a user multiplier.
- `ChartStyleOverrides.wordCloudScale` (types-social-dashboard.ts) persists the
  multiplier; threaded through `SocialWordCloudWidget` → `ThemeCloud` at both
  render sites in `SocialWidgetRenderer.tsx`.
- `ChartStyleEditor.tsx`: word-cloud-only "Size" control (Small 0.7 / Medium 1 /
  Large 1.4); 1 stored as undefined.

## Regression test
`frontend/src/features/studio/charts/theme-cloud-font.test.ts` — covers width
adaptivity, clamping, min/max proportion, scale multiplier, width-0 fallback.

## Commit
Branch `dev`, not yet committed.
