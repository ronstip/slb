# Dashboard collapses to one long narrow column (desktop + shared link)

## Symptom
One specific dashboard (agent `f9022b29-…`, layout `6f956e8282664e73a57191f948d4d8b3`,
share token `zvZpnv4SLQSpuGdemEgujzoiaa-8ZagCWHR7WRKea4Y`) rendered as a single
narrow left-hand column on desktop instead of its multi-column grid. Both the
editable view and the public share were affected. Other dashboards were fine.
The UI does not let you produce this layout manually.

## Repro
1. Open a dashboard in **edit mode** on desktop.
2. Make the container cross below the `lg` breakpoint (`<600px`): narrow the
   window, open it on a phone, or use a split/responsive view.
3. react-grid-layout switches to the `xs` (2-col) compact layout and fires
   `onLayoutChange` with it.
4. The change is auto-saved → the compact geometry is persisted as the canonical
   desktop layout. Reload on desktop → one narrow column.

## Root cause
`SocialDashboardGrid.handleLayoutChange` gated persistence on
`currentBreakpoint !== 'lg'` — a React state copy updated via RGL's
`onBreakpointChange`. RGL v2 fires `onBreakpointChange` **and** `onLayoutChange`
in the *same* commit when the width crosses a breakpoint
(`react-grid-layout/dist/chunk-QGXQSZII.js` effects at lines ~367 and ~408). At
the moment `onLayoutChange` runs, the just-scheduled `setCurrentBreakpoint('xs')`
has not applied, so the guard still reads `'lg'` and lets the compact layout
through. Every widget was written with `x=0` and `w<=2` (= `COLS.xs`), stacked by
cumulative `y` — a textbook `buildCompactLayout` output.

The corruption was invisible in `updated_at` because the editor save endpoint
(`POST /dashboard/layouts/{id}`) did not stamp `updated_at`; the doc still showed
the last *agent* write (5 days earlier), which sent the first investigation down
the wrong path. The shared prod/dev/local Firestore meant the bad write surfaced
on the public share immediately.

## Fix
1. **Frontend root cause** — `layout-persist-guard.ts::canPersistDesktopLayout`
   gates on the live measured container `width` (the same value RGL breakpoints
   on), not the lagging `currentBreakpoint` state. Wired into
   `SocialDashboardGrid.handleLayoutChange`. Test:
   `layout-persist-guard.test.ts`.
2. **Backend backstop** — `dashboard_layouts.py::_is_collapsed_mobile_layout`
   rejects (HTTP 422) any save where 3+ widgets are all at `x=0` and none wider
   than the `sm` (4-col) breakpoint. Targets only the compact signature; Story
   Mode (full-width `w=12` stack) and any real desktop layout pass. Test:
   `test_layout_collapse_guard.py`.
3. **Observability** — the editor save now stamps `updated_at` so a future
   manual save is dateable.

## Recovery
Firestore PITR retention was 1h, so the pre-corruption doc was unrecoverable by
time-travel. The desktop layout was reconstructed from the surviving widget
list (types/heights/order preserved in the compact `y` ordering).

## Fix location
Branch `DashboardDesign` (uncommitted at time of writing).
Files: `frontend/src/features/studio/dashboard/layout-persist-guard.ts`,
`SocialDashboardGrid.tsx`, `api/routers/dashboard_layouts.py`.
