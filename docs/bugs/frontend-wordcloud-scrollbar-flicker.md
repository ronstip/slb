# Word-cloud widget scrollbar flicker

## Symptom
Word-cloud widget ("Most Supported" etc.) flickers — vertical scrollbar toggles
on/off rapidly. Seen in Studio dashboard and on the public shared dashboard
(`/shared/:token`); both render the same component.

## Repro
Open any dashboard with a word-cloud widget whose content height sits right at
the widget's height boundary. The cloud oscillates.

## Root cause
Feedback loop between font size and scrollbar:
- `ThemeCloud` derives font size from the measured container width
  (`computeCloudFontRange`, `width * 0.055`) via a `ResizeObserver`.
- Larger fonts → taller content → vertical scrollbar appears on the
  `overflow-y-auto` wrapper → content box shrinks ~16px → smaller font →
  content fits → scrollbar disappears → width grows → repeat. Endless flicker.
- Classic Windows scrollbars take layout width (unlike macOS overlay
  scrollbars), so it reproduces on Windows.

## Fix
Two layers (`frontend/src/features/studio/dashboard/SocialWordCloudWidget.tsx`
+ `frontend/src/features/studio/charts/ThemeCloud.tsx`):
1. `[scrollbar-gutter:stable]` on the scroll wrapper — gutter is reserved
   whether or not the scrollbar shows, so width stops changing.
2. Hysteresis in the `ResizeObserver`: ignore width deltas <= 20px (smaller
   than a scrollbar) so the oscillation can't sustain even where
   `scrollbar-gutter` is unsupported. This is the durable backstop.

## Notes
A prior single-layer `scrollbar-gutter` fix was reverted before reaching the
shared page, so the shared dashboard appeared unfixed.

Fix branch: feat/shared-dashboard-marketing (uncommitted).

## Update — d3-cloud rewrite
`ThemeCloud` was rewritten to a `d3-cloud` spiral layout that *fits the box*
(absolute-positioned words, no flow/wrap). The `overflow-y-auto` wrapper in
`SocialWordCloudWidget` is gone (now `overflow-hidden`), so there is no
scrollbar to toggle — the feedback loop's root cause is structurally removed,
not just damped. The `ResizeObserver` hysteresis (ignore <=20px width/height
deltas) is kept as a cheap backstop and to avoid re-running the layout on
sub-scrollbar jitter.
