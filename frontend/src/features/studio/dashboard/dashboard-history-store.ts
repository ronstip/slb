import { create, useStore } from 'zustand';
import type { Mutate, StoreApi, UseBoundStore } from 'zustand';
import { temporal, type TemporalState } from 'zundo';
import type {
  DashboardOrientation,
  SocialDashboardWidget,
} from './types-social-dashboard.ts';
import { DEFAULT_DASHBOARD_ORIENTATION } from './types-social-dashboard.ts';

/** The undoable slice of a dashboard report. Filter-bar pill membership
 *  lives in the parent DashboardView and is *not* tracked here - keep the
 *  history focused on what users actually mean by "undo my edit". */
export interface ReportSnapshot {
  widgets: SocialDashboardWidget[];
  orientation: DashboardOrientation;
  filterBarHidden: boolean;
}

interface ReportHistoryActions {
  setWidgets: (
    updater:
      | SocialDashboardWidget[]
      | ((prev: SocialDashboardWidget[]) => SocialDashboardWidget[]),
  ) => void;
  setOrientation: (orientation: DashboardOrientation) => void;
  setFilterBarHidden: (hidden: boolean) => void;
  /** Atomic multi-field replace - used by the AI co-author so a single
   *  remote edit lands as one undo step instead of three. */
  applyExternalSnapshot: (snap: ReportSnapshot) => void;
}

export type ReportHistoryStore = ReportSnapshot & ReportHistoryActions;

/** Zustand store augmented with zundo's temporal mutator. The mutator
 *  attaches a `.temporal` substore exposing undo/redo/clear/pause/resume. */
export type ReportHistoryStoreApi = UseBoundStore<
  Mutate<
    StoreApi<ReportHistoryStore>,
    [['temporal', StoreApi<TemporalState<ReportSnapshot>>]]
  >
>;

const INITIAL_SNAPSHOT: ReportSnapshot = {
  widgets: [],
  orientation: DEFAULT_DASHBOARD_ORIENTATION,
  filterBarHidden: false,
};

/** Window used to coalesce rapid edits (drags, resizes, keystrokes) into a
 *  single history entry. Leading-edge: the first edit in a window pushes a
 *  past-state; further edits within the window are suppressed. After the
 *  window closes, the next edit reopens it. */
const GROUPING_WINDOW_MS = 600;

function shallowWidgetsEqual(
  a: SocialDashboardWidget[],
  b: SocialDashboardWidget[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function snapshotsEqual(a: ReportSnapshot, b: ReportSnapshot): boolean {
  return (
    a.orientation === b.orientation &&
    a.filterBarHidden === b.filterBarHidden &&
    shallowWidgetsEqual(a.widgets, b.widgets)
  );
}

/** Builds zundo's `handleSet` option as a leading-edge debounce: forwards
 *  the first set in a window, swallows the rest. Coalesces drag/resize/
 *  keystroke bursts into one undo step.
 *
 *  Typed loosely because zundo's `handleSet` parameter signature depends on
 *  Zustand's overloaded setState, which TS can't always resolve without
 *  triggering the "circularly references itself" diagnostic. The actual
 *  runtime contract is simple: receive args, forward args. */
function makeLeadingDebounceHandleSet(
  windowMs: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handleSet: (...args: any[]) => void) => {
    let cooldown = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (...args: any[]) => {
      if (cooldown) return;
      handleSet(...args);
      cooldown = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cooldown = false;
        timer = null;
      }, windowMs);
    };
  };
}

function createReportHistoryStore(): ReportHistoryStoreApi {
  return create<ReportHistoryStore>()(
    temporal(
      (set) => ({
        ...INITIAL_SNAPSHOT,
        setWidgets: (updater) =>
          set((state) => ({
            widgets:
              typeof updater === 'function'
                ? (updater as (
                    prev: SocialDashboardWidget[],
                  ) => SocialDashboardWidget[])(state.widgets)
                : updater,
          })),
        setOrientation: (orientation) => set({ orientation }),
        setFilterBarHidden: (filterBarHidden) => set({ filterBarHidden }),
        applyExternalSnapshot: (snap) => set(snap),
      }),
      {
        limit: 50,
        partialize: ({ widgets, orientation, filterBarHidden }) => ({
          widgets,
          orientation,
          filterBarHidden,
        }),
        equality: snapshotsEqual,
        // Leading-edge debounce: forward only the first set in a 600ms
        // window. Zundo's handleSet signature has gnarly overload juggling
        // around Zustand's setState - cast to a permissive shape rather
        // than fight the type system.
        handleSet: makeLeadingDebounceHandleSet(GROUPING_WINDOW_MS),
      },
    ),
  );
}

/** One store per (open) report. Reports stay cached across remounts so
 *  toggling edit mode or switching tabs preserves the undo stack - only an
 *  explicit hydrate or external takeover clears it. */
const storeCache = new Map<string, ReportHistoryStoreApi>();

export function getReportHistoryStore(artifactId: string): ReportHistoryStoreApi {
  let store = storeCache.get(artifactId);
  if (!store) {
    store = createReportHistoryStore();
    storeCache.set(artifactId, store);
  }
  return store;
}



/** Replace state without recording history. Use for the initial layout load
 *  and for foreign overwrites (another tab/user changed the report - keeping
 *  the local undo stack would let the user "undo" past someone else's edit
 *  and silently clobber it on the next save). */
export function hydrateReportHistory(
  store: ReportHistoryStoreApi,
  snap: ReportSnapshot,
): void {
  const temporalState = store.temporal.getState();
  temporalState.pause();
  store.setState(snap);
  temporalState.resume();
  temporalState.clear();
}

/** React hook: subscribe to undo/redo availability for a given store. */
export function useTemporalSelector<T>(
  store: ReportHistoryStoreApi,
  selector: (s: TemporalState<ReportSnapshot>) => T,
): T {
  return useStore(store.temporal, selector);
}
