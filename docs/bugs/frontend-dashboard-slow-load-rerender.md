# frontend — dashboard slow load / breakpoint switch

## Symptom
Dashboard slow on refresh (cold) and when switching desktop⇄mobile (hot), on both
the studio and the shared/public surface (they share `SocialDashboardGrid` →
`SocialWidgetRenderer` → Chart.js).

## Dominant cause (Chart.js)
The default layout mounts ~10 Chart.js canvases. The biggest costs are inside
Chart.js, not React:
- **Cold load:** each chart plays a ~1s enter **animation** (60fps canvas
  redraws) on the main thread, ×10 charts.
- **Desktop⇄mobile switch:** react-grid-layout retransitions every item; each
  chart's own `ResizeObserver` fires and, with Chart.js default
  `resizeDelay: 0`, redraws on every frame of the transition → a redraw storm.
  React `memo` can't help — Chart.js resizes itself outside React.

Fix: `BASE_CHART_PERF = { animation: false, resizeDelay: 200 }` spread into every
chart's `options` in `SocialChartWidget.tsx`. Hover/tooltips unaffected; revert
`animation: false` to get the mount fade-in back.

## Secondary cause (React re-renders)
1. **Hot (breakpoint switch):** flipping `currentBreakpoint` state inside
   `SocialDashboardGrid` re-renders the grid → every `SocialWidgetRenderer`
   re-rendered (it was **not** memoized) → every Chart.js chart rebuilt its
   `data`/`options` (new object refs each render) and re-animated. Aggregations
   were already memoized, so the cost was pure chart re-render × N widgets.
2. **Cold churn:** `handleAutoSize` (text/embed auto-fit on mount) repacked rows
   by spreading **every** widget into a new object (`{...w, y}`) even when `y`
   was unchanged → all widget refs changed → full re-render storm as cards
   settled.
3. Grid rebuilt `lgLayout` + 3× `buildCompactLayout` on every render incl. each
   resize tick.

## Fix
- `SocialWidgetRenderer` wrapped in `React.memo`; its `onConfigure/onRemove/
  onDuplicate` props made id-taking so the grid passes its stable parent
  handlers straight through (no per-render inline closures) → memo actually
  hits and unchanged widgets/charts skip re-render on breakpoint/resize.
- `handleAutoSize` repack now preserves a widget's object reference when its `y`
  is unchanged → only moved rows re-render.
- `lgLayout` and the compact `layouts` wrapped in `useMemo`.

No behaviour change — purely referential-stability / memoization.

## Regression test
Covered indirectly by `SocialDashboardGrid.test.ts` (compact layout output
unchanged) + `tsc`. Re-render behaviour is not unit-tested (no RTL harness for
the grid).

## Commit
Branch `DashboardDesign`, not yet committed at time of writing.
