/**
 * Decide whether a react-grid-layout `onLayoutChange` callback should be
 * persisted as the canonical DESKTOP (lg) layout.
 *
 * Why this exists: RGL is responsive. When the container narrows it switches to
 * a compact breakpoint (md/sm/xs) whose layout is auto-derived (single narrow
 * column, every widget at x=0). Those compact layouts are disposable - only the
 * lg layout is authored and persisted.
 *
 * The bug this guards against: RGL v2 fires `onBreakpointChange` and
 * `onLayoutChange` in the SAME commit when the width crosses a breakpoint. A
 * guard that reads the component's `currentBreakpoint` React state is one tick
 * stale at that moment (the `setCurrentBreakpoint('xs')` it just scheduled
 * hasn't applied), so it still reads 'lg' while RGL has already handed us the
 * 2-col xs layout - which then gets saved, collapsing every widget to x=0/w=2
 * (the "dashboard renders as one long column" corruption).
 *
 * The fix: gate on the live measured container `width` (the SAME value RGL
 * derives its breakpoint from) instead of the lagging state copy.
 */

// Minimum container width for the lg breakpoint. Single source of truth -
// SocialDashboardGrid's BREAKPOINTS.lg is derived from this.
export const LG_MIN_WIDTH = 600;

export function canPersistDesktopLayout(
  isEditMode: boolean,
  isDragging: boolean,
  width: number,
): boolean {
  return isEditMode && !isDragging && width >= LG_MIN_WIDTH;
}

/** Minimal x/y/w/h shape shared by a persisted widget and an RGL layout item. */
interface GridBox { i: string; x: number; y: number; w: number; h: number }

/**
 * True when an RGL `onLayoutChange` payload actually moves/resizes at least one
 * widget relative to the current persisted widgets.
 *
 * Why this exists: in edit mode RGL re-fires `onLayoutChange` on many renders -
 * including ones where it merely re-applied its own (already-compacted) layout,
 * so nothing really moved. If the handler commits anyway it builds a fresh
 * `widgets` array every time → `layouts` rebuilds → RGL re-fires
 * `onLayoutChange` → commit → … an infinite "Maximum update depth exceeded"
 * loop. This is especially easy to hit right after a story rewrite, where the
 * agent's row-packed layout and RGL's vertical compaction disagree by a row.
 * Committing only on a real geometry change makes the cycle idempotent: once the
 * positions settle, the next no-op re-fire is skipped and the loop ends.
 */
export function layoutHasGeometryChange(
  widgets: ReadonlyArray<GridBox>,
  layout: ReadonlyArray<GridBox>,
): boolean {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return widgets.some((w) => {
    const item = byId.get(w.i);
    return !!item && (item.x !== w.x || item.y !== w.y || item.w !== w.w || item.h !== w.h);
  });
}
