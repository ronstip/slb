# Frontend: dashboard auto-size render cascade (`?agg=server` cold load)

**Area:** frontend · **Branch:** WidgetsAndBugFix (uncommitted)

## Symptom

On a *cold* load of a shared dashboard with `?agg=server` and `layout_fully_covered=True`
(bounded posts returned), the browser console fills with:

```
Maximum update depth exceeded. This can happen when a component calls setState
inside useEffect, but useEffect either doesn't have a dependency array, or one
of its dependencies changes on every render.
```

The dashboard eventually settles and renders correctly; warm loads are clean.

## Root cause

1. `?agg=server` + `layout_fully_covered=True` → only ~10 bounded posts are returned
   instead of 8,554 → chart widgets short-circuit to `serverData` (trivially fast),
   so all 16 widgets finish their initial render in milliseconds.
2. Text/embed widgets set up a `ResizeObserver` that fires after a 120 ms debounce.
   Because rendering is near-instant, ALL debounces from all text widgets fire at
   nearly the same time.
3. Each fires `handleAutoSize(widgetId, newH)` which called
   `historyStore.getState().setWidgets(updater)` directly.
4. Zustand uses React's `useSyncExternalStore` under the hood.
   `useSyncExternalStore` **bypasses automatic batching**: it synchronously notifies
   subscribers on every store write, even from inside `setTimeout` callbacks.
5. With multiple rapid `setWidgets` calls, React detects a snapshot change
   mid-render ("tearing"), schedules a synchronous re-render, which triggers
   another `useSyncExternalStore` notification, etc. After 25 nested synchronous
   re-renders React aborts with the above error.

With full posts (8,554), aggregation takes long enough that renders are spread
out; each `setWidgets` call lands after React's current work-loop completes,
so automatic batching applies and the cascade never forms.

## Fix

[`frontend/src/features/studio/dashboard/SocialDashboardView.tsx`](../../frontend/src/features/studio/dashboard/SocialDashboardView.tsx)

Replaced the direct `setWidgets` call in `handleAutoSize` with a **batched,
animation-frame-deferred** approach:

- `pendingAutoSizes` ref (Map): accumulates all `(widgetId → newH)` entries
  from all ResizeObserver debounces that fire within the same animation frame.
- `autoSizeRaf` ref: a handle to the pending `requestAnimationFrame`.
- `handleAutoSize` pushes to the map and reschedules (via `cancelAnimationFrame`
  + `requestAnimationFrame`) a single flush callback.
- The flush reads all pending entries, applies them in one `setWidgets` call
  (with one repack pass), then clears the map.

`requestAnimationFrame` fires AFTER the browser has finished the current
JavaScript turn and React's work-loop has completed, so the Zustand store
update is never mid-render. Even if many ResizeObserver debounces fire in
quick succession they all land in the same rAF flush → one `setWidgets` →
one React re-render.

A cleanup `useEffect` cancels the pending rAF on component unmount.

## Defense-in-depth (session 2, 2026-06-19)

The cascade could not be reproduced on demand even on a genuine cold API cache
across 7 conditions (warm, network-delayed arrival, CPU-throttled 4–6×, true
cold, scrollbar-toggle viewport). Two hardening additions were made so a residual
oscillation can't re-form and is diagnosable if it does:

- **`scrollbar-gutter: stable` on `html`** ([globals.css](../../frontend/src/styles/globals.css)).
  A second amplifier of the same class: when a page's height hovers near the
  viewport height, the vertical scrollbar flips on/off as content settles, which
  changes the document content width by the scrollbar width (~17px on Windows).
  `react-grid-layout`'s `useContainerWidth` measures that width and rebuilds its
  `layouts` on every change → width→relayout→height→scrollbar feedback. Reserving
  the gutter permanently removes the width oscillation at the source (no-op on
  macOS overlay scrollbars; affects all pages, content ~17px narrower, no layout
  shift).
- **Dev-only auto-size churn detector** in `handleAutoSize`
  ([SocialDashboardView.tsx](../../frontend/src/features/studio/dashboard/SocialDashboardView.tsx)):
  if >20 height-changing rAF flushes land within 2s it `console.warn`s the
  offending widget ids. Stripped from prod (`import.meta.env.DEV`). Watch for it
  on real cold loads before treating the cascade as fully closed.

## Test

No automated test for this specific timing issue (ResizeObserver + rAF
coordination is hard to unit-test). Manually verify:

1. Restart the API (cold cache): `.venv\Scripts\python -m uvicorn api.main:app --host 127.0.0.1 --port 8000`
2. Open `http://localhost:5174/shared/<token>?agg=server&slim=1` in a browser
3. Watch the browser console — no "Maximum update depth exceeded" should appear
4. The dashboard should render correctly (all widgets showing server data)

The warm-load path was already clean and remains unaffected.
