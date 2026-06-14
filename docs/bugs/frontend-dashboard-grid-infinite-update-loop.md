# Dashboard grid: "Maximum update depth exceeded" after a story rewrite

**Symptom:** After running a Story Mode rewrite from the Co-author popover, the
app crashed with React's unrecoverable "Unexpected Application Error / Maximum
update depth exceeded", thrown from inside `react-grid-layout` (v2.2.2) during a
passive effect (`dispatchSetState` at react-grid-layout's internal effect). The
story persisted but the page "stopped in the middle".

**Repro:** open a dashboard in edit mode (the co-author session is effectively
edit mode) whose layout RGL wants to re-compact differently than it is stored -
e.g. right after a story rewrite where the agent's row-packed positions and
RGL's `compactType:"vertical"` disagree by a row.

**Root cause:** `SocialDashboardGrid.handleLayoutChange` committed *every* RGL
`onLayoutChange` callback. RGL re-fires that callback even when it merely
re-applied its own (already-compacted) layout - nothing actually moved. Each
commit rebuilt the `widgets` array → the memoized `layouts` rebuilt → RGL
re-rendered → fired `onLayoutChange` again → commit … an infinite loop. The
view-mode case was masked by `canPersistDesktopLayout` returning false; edit
mode had no equality guard, so a story rewrite reliably tripped it. (The
Chart.js `Cannot read 'ownerDocument'` errors seen alongside are a symptom of
the same re-render storm detaching/resizing canvases; they stop once the loop
is broken.)

**Fix:** add `layoutHasGeometryChange(widgets, layout)` in
[layout-persist-guard.ts](../../frontend/src/features/studio/dashboard/layout-persist-guard.ts)
and skip the commit in `handleLayoutChange` when no widget's x/y/w/h actually
changed (a pending manual resize still commits, to record `manualHeight`). RGL's
compaction is idempotent, so once positions settle the next no-op re-fire is
skipped and the cycle terminates.

**Tests:** `layout-persist-guard.test.ts` (`layoutHasGeometryChange` no-op vs
real-change cases). Verified live: re-ran a Story Mode rewrite on a real
dashboard via the Co-author popover - completed with no crash, no
"Maximum update depth" in the console, KPIs rendered distinct topic-scoped
values, grid packed.

**Fix commit:** branch `DashboardDesign` (uncommitted).
