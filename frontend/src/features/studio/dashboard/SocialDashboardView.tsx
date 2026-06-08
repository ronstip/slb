import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { CustomFieldDef, DashboardKpis, DashboardPost, TopicMetric } from '../../../api/types.ts';
import type { SocialDashboardWidget, DashboardOrientation } from './types-social-dashboard.ts';
import { AGGREGATION_META, DEFAULT_DASHBOARD_ORIENTATION } from './types-social-dashboard.ts';
import type { DashboardFilters, FilterOptions } from './use-dashboard-filters.ts';
import { useSocialDashboardStore } from './social-dashboard-store.ts';
import {
  getReportHistoryStore,
  hydrateReportHistory,
  useTemporalSelector,
} from './dashboard-history-store.ts';
import { getDefaultLayout } from './defaults-social-dashboard.ts';
import { DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import { useDashboardLayout, useSaveDashboardLayout } from './hooks/useDashboardLayout.ts';
import { SocialDashboardGrid } from './SocialDashboardGrid.tsx';
import { SocialWidgetConfigDialog } from './widget-config/SocialWidgetConfigDialog.tsx';
import type { AttachedWidget } from './coauthor-context.ts';

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Old hardcoded KPI accent colors - strip these so cards fall back to theme-derived colors */
const LEGACY_KPI_ACCENTS = new Set([
  '#3574d4', '#1a9e6f', '#c9a030', '#d45432', '#8b55c8',
  '#2B5066', '#4A7C8F', '#3E6B52', '#6B3040', '#4A5568',
]);

function migrateWidgets(widgets: SocialDashboardWidget[]): SocialDashboardWidget[] {
  return widgets.map((w) => {
    if (w.aggregation === 'kpi' && w.accent && LEGACY_KPI_ACCENTS.has(w.accent)) {
      const { accent: _, ...rest } = w;
      return rest;
    }
    return w;
  });
}

export type AddWidgetKind = 'chart' | 'text' | 'embeds';

export interface DashboardToolbarHandlers {
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: (kind: AddWidgetKind) => void;
  onResetToDefaults: () => void;
  orientation: DashboardOrientation;
  onOrientationChange: (orientation: DashboardOrientation) => void;
  filterBarHidden: boolean;
  onFilterBarHiddenChange: (hidden: boolean) => void;
  isSaving: boolean;
  isEditMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface SocialDashboardViewProps {
  artifactId: string;
  filteredPosts: DashboardPost[];
  allPosts: DashboardPost[];
  /** Agent-scoped topic_metrics rows. Empty when no agent context. */
  topics?: TopicMetric[];
  availableOptions: FilterOptions;
  truncated?: boolean;
  activeFilterCount: number;
  toggleFilterValue: (key: ArrayFilterKey, value: string) => void;
  readOnly?: boolean;
  filterBarFilters?: string[];
  onLayoutLoaded?: (filterBarFilters: string[]) => void;
  onToolbarReady?: (handlers: DashboardToolbarHandlers) => void;
  onOrientationChange?: (orientation: DashboardOrientation) => void;
  gridRef?: React.RefObject<HTMLElement | null>;
  /** Custom default layout used when no saved layout exists */
  defaultLayout?: SocialDashboardWidget[];
  /** Default orientation used when no persisted orientation is available
   * (e.g. shared/public dashboards where the layout endpoint 401s). */
  defaultOrientation?: DashboardOrientation;
  /** Server-computed KPIs (passed only when no client filters are active) */
  serverKpis?: DashboardKpis;
  /** Agent context - used to ground AI compose for widget annotations. */
  agentId?: string;
  /** Declared custom-field definitions (incl. element_fields for list[object]).
   *  Enables typed object-leaf dimensions/metrics in widget config. Undefined on
   *  dashboards with no agent context. */
  customFieldDefs?: CustomFieldDef[];
  /** Bumped by the parent when an external mutation (e.g. AI co-author writes
   *  via update_dashboard) lands. Triggers a re-sync of local `widgets` state
   *  from the freshly-refetched layout. Without this, the one-shot
   *  initialisation guard below keeps the grid showing stale local state. */
  externalSyncKey?: number;
  /** True while the AI co-author popover is open. Enables the per-widget
   *  "pin to message" affordance on the grid. */
  coAuthorActive?: boolean;
  /** Ids of widgets currently pinned to the co-author message. */
  attachedWidgetIds?: string[];
  /** Toggle a widget's pin. Receives id + current title for the chip. */
  onToggleAttachWidget?: (w: AttachedWidget) => void;
}

export function SocialDashboardView({
  artifactId,
  filteredPosts,
  allPosts,
  topics = [],
  availableOptions,
  truncated: _truncated,
  activeFilterCount: _activeFilterCount,
  toggleFilterValue,
  readOnly = false,
  filterBarFilters,
  onLayoutLoaded,
  onToolbarReady,
  onOrientationChange,
  gridRef,
  defaultLayout,
  defaultOrientation,
  serverKpis,
  agentId,
  customFieldDefs,
  externalSyncKey = 0,
  coAuthorActive = false,
  attachedWidgetIds,
  onToggleAttachWidget,
}: SocialDashboardViewProps) {
  const { isEditMode, setEditMode } = useSocialDashboardStore();
  const navigate = useNavigate();
  const attachedSet = useMemo(
    () => new Set(attachedWidgetIds ?? []),
    [attachedWidgetIds],
  );
  // Topic widgets navigate to the topic detail page on item click. Only wired
  // when an agent context is available (orphan dashboards have no detail
  // route to land on); public/shared dashboards pass no navigate.
  const onTopicNavigate = useMemo(
    () => (agentId ? (clusterId: string) =>
      navigate(`/agents/${agentId}/topics/${clusterId}/analytics`)
      : undefined),
    [agentId, navigate],
  );

  // Distinct custom enrichment field names present on the dataset - surfaced
  // as additional Group by options in the widget config dialog.
  const customFieldNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of allPosts) {
      if (!p.custom_fields) continue;
      for (const k of Object.keys(p.custom_fields)) names.add(k);
    }
    return [...names].sort();
  }, [allPosts]);

  // Declared list[object] fields - the only ones eligible for typed object-leaf
  // dimensions/metrics. Empty when no agent context (object widgets still render
  // from self-describing tokens, they just can't be newly configured).
  const objectFieldDefs = useMemo(
    () => (customFieldDefs ?? []).filter((d) => d.type === 'list[object]'),
    [customFieldDefs],
  );

  // Undo/redo-backed state. One store per artifactId; the cache survives
  // remounts so the user's edit history persists across edit-mode toggles
  // and tab switches.
  const historyStore = useMemo(
    () => getReportHistoryStore(artifactId),
    [artifactId],
  );
  const widgets = useStore(historyStore, (s) => s.widgets);
  const orientation = useStore(historyStore, (s) => s.orientation);
  const filterBarHidden = useStore(historyStore, (s) => s.filterBarHidden);
  const canUndo = useTemporalSelector(historyStore, (s) => s.pastStates.length > 0);
  const canRedo = useTemporalSelector(historyStore, (s) => s.futureStates.length > 0);

  // Single config dialog for both add + edit
  const [configWidget, setConfigWidget] = useState<SocialDashboardWidget | null>(null);
  const [configMode, setConfigMode] = useState<'add' | 'edit'>('edit');

  // Load persisted layout. Skipped in readOnly (shared) mode - the layout is
  // already inlined in the public share response and the authed endpoint 401s
  // for unauthenticated viewers, which now globally redirects to landing.
  const { data: layoutData, isLoading: layoutLoading } = useDashboardLayout(
    artifactId,
    { enabled: !readOnly },
  );
  const { mutate: saveLayout, mutateAsync: saveLayoutAsync, isPending: isSaving } = useSaveDashboardLayout(artifactId);

  // Initialise widgets from persisted layout or defaults. Hydrates the
  // history store without recording an entry (initial load isn't undoable).
  const initialised = useRef(false);
  useEffect(() => {
    if (layoutLoading || initialised.current) return;
    initialised.current = true;
    const persistedOrientation = layoutData?.orientation ?? defaultOrientation ?? DEFAULT_DASHBOARD_ORIENTATION;
    hydrateReportHistory(historyStore, {
      widgets:
        layoutData?.layout && layoutData.layout.length > 0
          ? migrateWidgets(layoutData.layout)
          : (defaultLayout ?? getDefaultLayout()),
      orientation: persistedOrientation,
      filterBarHidden: layoutData?.filterBarHidden ?? false,
    });
    onOrientationChange?.(persistedOrientation);
    if (onLayoutLoaded) {
      const persisted = layoutData?.filterBarFilters;
      onLayoutLoaded(persisted && persisted.length > 0 ? persisted : DEFAULT_FILTER_BAR_FILTERS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutData, layoutLoading]);

  // External re-sync: when the AI co-author (or any external writer) has
  // mutated the layout via update_dashboard, the parent invalidates the
  // dashboard-layout query and bumps `externalSyncKey`. We push the new
  // snapshot through `applyExternalSnapshot` so the change lands as a
  // single undo step - user hits Cmd+Z once to revert an AI edit, even
  // when it touched multiple widgets at once. Skipped on the first render
  // (key starts at 0) so we don't fight the one-shot initialiser above.
  const lastSyncedKey = useRef(0);
  useEffect(() => {
    if (externalSyncKey === 0 || externalSyncKey === lastSyncedKey.current) return;
    if (!layoutData?.layout) return;
    lastSyncedKey.current = externalSyncKey;
    const current = historyStore.getState();
    current.applyExternalSnapshot({
      widgets: migrateWidgets(layoutData.layout),
      orientation: layoutData.orientation ?? current.orientation,
      filterBarHidden:
        typeof layoutData.filterBarHidden === 'boolean'
          ? layoutData.filterBarHidden
          : current.filterBarHidden,
    });
  }, [externalSyncKey, layoutData, historyStore]);

  // Refs so callbacks always capture latest values without re-creating
  const filterBarFiltersRef = useRef(filterBarFilters ?? DEFAULT_FILTER_BAR_FILTERS);
  useEffect(() => { filterBarFiltersRef.current = filterBarFilters ?? DEFAULT_FILTER_BAR_FILTERS; }, [filterBarFilters]);
  const widgetsRef = useRef(widgets);
  useEffect(() => { widgetsRef.current = widgets; }, [widgets]);
  const orientationRef = useRef(orientation);
  useEffect(() => { orientationRef.current = orientation; }, [orientation]);
  const filterBarHiddenRef = useRef(filterBarHidden);
  useEffect(() => { filterBarHiddenRef.current = filterBarHidden; }, [filterBarHidden]);

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSave = useCallback(
    (
      updatedWidgets: SocialDashboardWidget[],
      updatedFilterBar?: string[],
      updatedOrientation?: DashboardOrientation,
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveLayout({
          layout: updatedWidgets,
          filterBarFilters: updatedFilterBar ?? filterBarFiltersRef.current,
          orientation: updatedOrientation ?? orientationRef.current,
          filterBarHidden: filterBarHiddenRef.current,
        });
      }, 800);
    },
    [saveLayout],
  );

  // Auto-save when filterBarFilters prop changes (user added/removed/reordered a pill)
  const prevFilterBarRef = useRef<string[] | undefined>(undefined);
  useEffect(() => {
    if (!isEditMode) return;
    if (filterBarFilters === prevFilterBarRef.current) return;
    prevFilterBarRef.current = filterBarFilters;
    if (filterBarFilters !== undefined) {
      scheduleAutoSave(widgetsRef.current, filterBarFilters);
    }
  }, [filterBarFilters, isEditMode, scheduleAutoSave]);

  const handleLayoutChange = useCallback(
    (updated: SocialDashboardWidget[]) => {
      historyStore.getState().setWidgets(updated);
      if (isEditMode) scheduleAutoSave(updated);
    },
    [historyStore, isEditMode, scheduleAutoSave],
  );

  // Auto-size handler for text widgets: when a widget reports its measured
  // height, update its `h` and repack the y-positions of all widgets below it
  // in the same column. Vertical layouts (full-width widgets) collapse cleanly;
  // multi-column rows fall back to a stable minimum y advancement.
  const handleAutoSize = useCallback(
    (widgetId: string, newH: number) => {
      historyStore.getState().setWidgets((prev) => {
        const idx = prev.findIndex((w) => w.i === widgetId);
        if (idx === -1) return prev;
        if (prev[idx].h === newH) return prev;
        const next = prev.slice();
        next[idx] = { ...prev[idx], h: newH };
        // Repack rows below the changed widget. Build a fresh y-layout by
        // sweeping the list, preserving each widget's relative order and
        // packing it just below the previous row's bottom.
        const sorted = next
          .map((w, i) => ({ ...w, _origIdx: i }))
          .sort((a, b) => a.y - b.y || a.x - b.x);
        let cursorY = 0;
        let rowMaxBottom = 0;
        let rowStartY = sorted.length > 0 ? sorted[0].y : 0;
        const yMap = new Map<number, number>();
        for (const w of sorted) {
          if (w.y !== rowStartY) {
            cursorY = rowMaxBottom;
            rowStartY = w.y;
            rowMaxBottom = cursorY + w.h;
          } else {
            rowMaxBottom = Math.max(rowMaxBottom, cursorY + w.h);
          }
          yMap.set(w._origIdx, cursorY);
        }
        const repacked = next.map((w, i) => ({ ...w, y: yMap.get(i) ?? w.y }));
        return repacked;
      });
    },
    [historyStore],
  );

  const handleDone = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await saveLayoutAsync({
        layout: widgetsRef.current,
        filterBarFilters: filterBarFiltersRef.current,
        orientation: orientationRef.current,
        filterBarHidden: filterBarHiddenRef.current,
      });
      setEditMode(false);
    } catch (err) {
      // Stay in edit mode so the user can retry, but surface the failure.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[dashboard] save layout failed', err);
      toast.error('Failed to save dashboard layout', { description: msg });
    }
  }, [setEditMode, saveLayoutAsync]);

  const handleOrientationChange = useCallback(
    (next: DashboardOrientation) => {
      historyStore.getState().setOrientation(next);
      onOrientationChange?.(next);
      scheduleAutoSave(widgetsRef.current, filterBarFiltersRef.current, next);
    },
    [historyStore, onOrientationChange, scheduleAutoSave],
  );

  const handleResetToDefaults = useCallback(() => {
    const defaults = defaultLayout ?? getDefaultLayout();
    historyStore.getState().setWidgets(defaults);
    scheduleAutoSave(defaults);
  }, [defaultLayout, historyStore, scheduleAutoSave]);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    historyStore.getState().setWidgets((prev) => {
      const updated = prev.filter((w) => w.i !== widgetId);
      scheduleAutoSave(updated);
      return updated;
    });
  }, [historyStore, scheduleAutoSave]);

  // Open config dialog for an existing widget
  const handleOpenEdit = useCallback((widgetId: string) => {
    const w = widgetsRef.current.find((w) => w.i === widgetId);
    if (w) {
      setConfigWidget(w);
      setConfigMode('edit');
    }
  }, []);

  // Open config dialog for a new widget. Chart starts as custom; text starts
  // blank markdown; embeds starts with an empty URL list.
  const handleOpenAdd = useCallback((kind: AddWidgetKind = 'chart') => {
    const metaKey = kind === 'text' ? 'text' : kind === 'embeds' ? 'embeds' : 'custom';
    const meta = AGGREGATION_META[metaKey];
    let draft: SocialDashboardWidget;
    if (kind === 'text') {
      draft = {
        i: nanoid(),
        x: 0,
        y: Infinity,
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
        aggregation: 'text',
        chartType: meta.defaultChartType,
        title: meta.defaultTitle,
        markdownContent: '',
      };
    } else if (kind === 'embeds') {
      draft = {
        i: nanoid(),
        x: 0,
        y: Infinity,
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
        aggregation: 'embeds',
        chartType: meta.defaultChartType,
        title: meta.defaultTitle,
        embedUrls: [],
      };
    } else {
      draft = {
        i: nanoid(),
        x: 0,
        y: Infinity,
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
        aggregation: 'custom',
        chartType: meta.defaultChartType,
        title: meta.defaultTitle,
        customConfig: { metric: 'post_count' },
      };
    }
    setConfigWidget(draft);
    setConfigMode('add');
  }, []);

  const handleDuplicateWidget = useCallback((widgetId: string) => {
    const w = widgetsRef.current.find((w) => w.i === widgetId);
    if (!w) return;
    const clone: SocialDashboardWidget = { ...w, i: nanoid(), y: Infinity };
    historyStore.getState().setWidgets((prev) => {
      const next = [...prev, clone];
      scheduleAutoSave(next);
      return next;
    });
  }, [historyStore, scheduleAutoSave]);

  // Save from config dialog (handles both add and update) - save immediately, don't rely on debounce
  const handleSaveWidget = useCallback((saved: SocialDashboardWidget) => {
    setConfigWidget(null);
    const prev = widgetsRef.current;
    const exists = prev.some((w) => w.i === saved.i);
    const next = exists
      ? prev.map((w) => (w.i === saved.i ? saved : w))
      : [...prev, saved];
    widgetsRef.current = next;
    historyStore.getState().setWidgets(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveLayout({
      layout: next,
      filterBarFilters: filterBarFiltersRef.current,
      orientation: orientationRef.current,
      filterBarHidden: filterBarHiddenRef.current,
    });
  }, [historyStore, saveLayout]);

  const handleFilterBarHiddenChange = useCallback(
    (hidden: boolean) => {
      historyStore.getState().setFilterBarHidden(hidden);
      filterBarHiddenRef.current = hidden;
      scheduleAutoSave(widgetsRef.current);
    },
    [historyStore, scheduleAutoSave],
  );

  const handleFilterToggle = useCallback(
    (key: string, value: string) => toggleFilterValue(key as ArrayFilterKey, value),
    [toggleFilterValue],
  );

  // Undo/redo. Both mutate the history store, then nudge autosave so the
  // restored state lands in Firestore - without this, the user undoes
  // locally but the next reload brings the un-undone version back.
  const handleUndo = useCallback(() => {
    const temporalState = historyStore.temporal.getState();
    if (temporalState.pastStates.length === 0) return;
    temporalState.undo();
    const next = historyStore.getState();
    scheduleAutoSave(next.widgets, undefined, next.orientation);
  }, [historyStore, scheduleAutoSave]);

  const handleRedo = useCallback(() => {
    const temporalState = historyStore.temporal.getState();
    if (temporalState.futureStates.length === 0) return;
    temporalState.redo();
    const next = historyStore.getState();
    scheduleAutoSave(next.widgets, undefined, next.orientation);
  }, [historyStore, scheduleAutoSave]);

  // Keyboard shortcuts - only active while editing the report. Cmd/Ctrl+Z
  // undoes, Cmd/Ctrl+Shift+Z or Ctrl+Y redoes. Suppressed inside form
  // fields so widget-title inputs still get native undo.
  useEffect(() => {
    if (readOnly || !isEditMode) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, isEditMode, handleUndo, handleRedo]);

  // Publish toolbar handlers to parent when they change
  const onToolbarReadyRef = useRef(onToolbarReady);
  useEffect(() => { onToolbarReadyRef.current = onToolbarReady; }, [onToolbarReady]);
  useEffect(() => {
    if (readOnly) return;
    onToolbarReadyRef.current?.({
      onEdit: () => setEditMode(true),
      onDone: handleDone,
      onAddWidget: handleOpenAdd,
      onResetToDefaults: handleResetToDefaults,
      orientation,
      onOrientationChange: handleOrientationChange,
      filterBarHidden,
      onFilterBarHiddenChange: handleFilterBarHiddenChange,
      isSaving,
      isEditMode,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo,
      canRedo,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, isSaving, handleDone, handleOpenAdd, handleResetToDefaults, handleOrientationChange, orientation, filterBarHidden, handleFilterBarHiddenChange, readOnly, handleUndo, handleRedo, canUndo, canRedo]);

  if (layoutLoading || widgets.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Grid - keyed on orientation so a landscape/portrait switch remounts
          and re-measures the container width (RGL scales its 12 cols to the
          measured width; a stale measure leaves panels at the old width). */}
      <SocialDashboardGrid
        key={orientation}
        widgets={widgets}
        filteredPosts={filteredPosts}
        topics={topics}
        isEditMode={isEditMode && !readOnly}
        orientation={orientation}
        onLayoutChange={handleLayoutChange}
        onConfigure={handleOpenEdit}
        onRemove={handleRemoveWidget}
        onDuplicate={!readOnly ? handleDuplicateWidget : undefined}
        onFilterToggle={handleFilterToggle}
        onTopicNavigate={onTopicNavigate}
        gridRef={gridRef}
        serverKpis={serverKpis}
        onAutoSize={handleAutoSize}
        coAuthorActive={coAuthorActive}
        attachedWidgetIds={attachedSet}
        onToggleAttachWidget={onToggleAttachWidget}
      />

      {/* Single config dialog - used for both add and edit */}
      <SocialWidgetConfigDialog
        open={configWidget !== null}
        widget={configWidget}
        mode={configMode}
        allPosts={allPosts}
        filteredPosts={filteredPosts}
        availableOptions={availableOptions}
        onSave={handleSaveWidget}
        onClose={() => setConfigWidget(null)}
        customFieldNames={customFieldNames}
        objectFieldDefs={objectFieldDefs}
        agentId={agentId}
        topics={topics}
      />
    </div>
  );
}
