import { useState, useCallback, useEffect, useRef } from 'react';
import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';
import { AGGREGATION_META } from './types-social-dashboard.ts';
import type { DashboardFilters, FilterOptions } from './use-dashboard-filters.ts';
import { useSocialDashboardStore } from './social-dashboard-store.ts';
import { getDefaultLayout } from './defaults-social-dashboard.ts';
import { DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import { useDashboardLayout, useSaveDashboardLayout } from './hooks/useDashboardLayout.ts';
import { SocialDashboardGrid } from './SocialDashboardGrid.tsx';
import { SocialWidgetConfigDialog } from './widget-config/SocialWidgetConfigDialog.tsx';

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Old hardcoded KPI accent colors — strip these so cards fall back to theme-derived colors */
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

export interface DashboardToolbarHandlers {
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: () => void;
  onResetToDefaults: () => void;
  isSaving: boolean;
  isEditMode: boolean;
}

interface SocialDashboardViewProps {
  artifactId: string;
  filteredPosts: DashboardPost[];
  allPosts: DashboardPost[];
  availableOptions: FilterOptions;
  truncated?: boolean;
  activeFilterCount: number;
  toggleFilterValue: (key: ArrayFilterKey, value: string) => void;
  readOnly?: boolean;
  filterBarFilters?: string[];
  onLayoutLoaded?: (filterBarFilters: string[]) => void;
  onToolbarReady?: (handlers: DashboardToolbarHandlers) => void;
  gridRef?: React.RefObject<HTMLElement | null>;
  /** Custom default layout used when no saved layout exists */
  defaultLayout?: SocialDashboardWidget[];
  /** Server-computed KPIs (passed only when no client filters are active) */
  serverKpis?: DashboardKpis;
}

export function SocialDashboardView({
  artifactId,
  filteredPosts,
  allPosts,
  availableOptions,
  truncated: _truncated,
  activeFilterCount: _activeFilterCount,
  toggleFilterValue,
  readOnly = false,
  filterBarFilters,
  onLayoutLoaded,
  onToolbarReady,
  gridRef,
  defaultLayout,
  serverKpis,
}: SocialDashboardViewProps) {
  const { isEditMode, setEditMode } = useSocialDashboardStore();

  const [widgets, setWidgets] = useState<SocialDashboardWidget[]>([]);
  // Single config dialog for both add + edit
  const [configWidget, setConfigWidget] = useState<SocialDashboardWidget | null>(null);
  const [configMode, setConfigMode] = useState<'add' | 'edit'>('edit');

  // Load persisted layout
  const { data: layoutData, isLoading: layoutLoading } = useDashboardLayout(artifactId);
  const { mutate: saveLayout, isPending: isSaving } = useSaveDashboardLayout(artifactId);

  // Initialise widgets from persisted layout or defaults
  const initialised = useRef(false);
  useEffect(() => {
    if (layoutLoading || initialised.current) return;
    initialised.current = true;
    if (layoutData?.layout && layoutData.layout.length > 0) {
      setWidgets(migrateWidgets(layoutData.layout));
    } else {
      setWidgets(defaultLayout ?? getDefaultLayout());
    }
    if (onLayoutLoaded) {
      const persisted = layoutData?.filterBarFilters;
      onLayoutLoaded(persisted && persisted.length > 0 ? persisted : DEFAULT_FILTER_BAR_FILTERS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutData, layoutLoading]);

  // Refs so callbacks always capture latest values without re-creating
  const filterBarFiltersRef = useRef(filterBarFilters ?? DEFAULT_FILTER_BAR_FILTERS);
  useEffect(() => { filterBarFiltersRef.current = filterBarFilters ?? DEFAULT_FILTER_BAR_FILTERS; }, [filterBarFilters]);
  const widgetsRef = useRef(widgets);
  useEffect(() => { widgetsRef.current = widgets; }, [widgets]);

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSave = useCallback(
    (updatedWidgets: SocialDashboardWidget[], updatedFilterBar?: string[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveLayout({
          layout: updatedWidgets,
          filterBarFilters: updatedFilterBar ?? filterBarFiltersRef.current,
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
      setWidgets(updated);
      if (isEditMode) scheduleAutoSave(updated);
    },
    [isEditMode, scheduleAutoSave],
  );

  const handleDone = useCallback(() => {
    setEditMode(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveLayout({ layout: widgetsRef.current, filterBarFilters: filterBarFiltersRef.current });
  }, [setEditMode, saveLayout]);

  const handleResetToDefaults = useCallback(() => {
    const defaults = defaultLayout ?? getDefaultLayout();
    setWidgets(defaults);
    scheduleAutoSave(defaults);
  }, [defaultLayout, scheduleAutoSave]);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    setWidgets((prev) => {
      const updated = prev.filter((w) => w.i !== widgetId);
      scheduleAutoSave(updated);
      return updated;
    });
  }, [scheduleAutoSave]);

  // Open config dialog for an existing widget
  const handleOpenEdit = useCallback((widgetId: string) => {
    const w = widgetsRef.current.find((w) => w.i === widgetId);
    if (w) {
      setConfigWidget(w);
      setConfigMode('edit');
    }
  }, []);

  // Open config dialog for a new widget (starts as custom with empty config)
  const handleOpenAdd = useCallback(() => {
    const meta = AGGREGATION_META['custom'];
    const draft: SocialDashboardWidget = {
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
    setConfigWidget(draft);
    setConfigMode('add');
  }, []);

  const handleDuplicateWidget = useCallback((widgetId: string) => {
    const w = widgetsRef.current.find((w) => w.i === widgetId);
    if (!w) return;
    const clone: SocialDashboardWidget = { ...w, i: nanoid(), y: Infinity };
    setWidgets((prev) => {
      const next = [...prev, clone];
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  // Save from config dialog (handles both add and update) — save immediately, don't rely on debounce
  const handleSaveWidget = useCallback((saved: SocialDashboardWidget) => {
    setConfigWidget(null);
    const prev = widgetsRef.current;
    const exists = prev.some((w) => w.i === saved.i);
    const next = exists
      ? prev.map((w) => (w.i === saved.i ? saved : w))
      : [...prev, saved];
    widgetsRef.current = next;
    setWidgets(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveLayout({ layout: next, filterBarFilters: filterBarFiltersRef.current });
  }, [saveLayout]);

  const handleFilterToggle = useCallback(
    (key: string, value: string) => toggleFilterValue(key as ArrayFilterKey, value),
    [toggleFilterValue],
  );

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
      isSaving,
      isEditMode,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, isSaving, handleDone, handleOpenAdd, handleResetToDefaults, readOnly]);

  if (layoutLoading || widgets.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Grid */}
      <SocialDashboardGrid
        widgets={widgets}
        filteredPosts={filteredPosts}
        isEditMode={isEditMode && !readOnly}
        onLayoutChange={handleLayoutChange}
        onConfigure={handleOpenEdit}
        onRemove={handleRemoveWidget}
        onDuplicate={!readOnly ? handleDuplicateWidget : undefined}
        onFilterToggle={handleFilterToggle}
        gridRef={gridRef}
        serverKpis={serverKpis}
      />

      {/* Single config dialog — used for both add and edit */}
      <SocialWidgetConfigDialog
        open={configWidget !== null}
        widget={configWidget}
        mode={configMode}
        allPosts={allPosts}
        filteredPosts={filteredPosts}
        availableOptions={availableOptions}
        onSave={handleSaveWidget}
        onClose={() => setConfigWidget(null)}
      />
    </div>
  );
}
