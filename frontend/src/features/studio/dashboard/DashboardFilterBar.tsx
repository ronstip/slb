import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { X, Filter, Calendar, Plus, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover.tsx';
import { Checkbox } from '../../../components/ui/checkbox.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { cn } from '../../../lib/utils.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { DashboardPost } from '../../../api/types.ts';
import type { DashboardFilters, FilterOptions } from './use-dashboard-filters.ts';

export type FilterBarFilterId =
  | 'sentiment'
  | 'emotion'
  | 'platform'
  | 'date_range'
  | 'themes'
  | 'entities'
  | 'language'
  | 'content_type'
  | 'channels'
  | 'collection';

export const ALL_FILTER_BAR_IDS: FilterBarFilterId[] = [
  'sentiment', 'emotion', 'platform', 'date_range', 'themes',
  'entities', 'language', 'content_type', 'channels', 'collection',
];

export const DEFAULT_FILTER_BAR_FILTERS: FilterBarFilterId[] = [
  'sentiment', 'emotion', 'platform', 'date_range', 'themes',
  'entities', 'language', 'content_type', 'channels',
];

const FILTER_LABELS: Record<FilterBarFilterId, string> = {
  sentiment: 'Sentiment',
  emotion: 'Emotion',
  platform: 'Platform',
  date_range: 'Date Range',
  themes: 'Themes',
  entities: 'Entities',
  language: 'Language',
  content_type: 'Content Type',
  channels: 'Channels',
  collection: 'Collection',
};

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

interface DashboardFilterBarProps {
  filters: DashboardFilters;
  availableOptions: FilterOptions;
  activeFilterCount: number;
  onToggle: (key: ArrayFilterKey, value: string) => void;
  onSetFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  onClearAll: () => void;
  collectionNames?: Record<string, string>;
  /** When true, shows controls to add/remove/reorder filter pills */
  isEditMode?: boolean;
  /** Ordered list of active filter IDs — undefined = show all defaults */
  filterBarFilters?: string[];
  onFilterBarChange?: (filters: FilterBarFilterId[]) => void;
  /** All posts (unfiltered) — used to compute per-option counts */
  allPosts?: DashboardPost[];
}

type OptionCounts = Record<string, Record<string, number>>;

function computeOptionCounts(posts: DashboardPost[]): OptionCounts {
  const counts: OptionCounts = {
    sentiment: {},
    emotion: {},
    platform: {},
    language: {},
    content_type: {},
    channels: {},
    themes: {},
    entities: {},
    collection: {},
  };
  for (const p of posts) {
    if (p.sentiment) counts.sentiment[p.sentiment] = (counts.sentiment[p.sentiment] ?? 0) + 1;
    if (p.emotion && p.emotion !== 'unknown') counts.emotion[p.emotion] = (counts.emotion[p.emotion] ?? 0) + 1;
    counts.platform[p.platform] = (counts.platform[p.platform] ?? 0) + 1;
    if (p.language) counts.language[p.language] = (counts.language[p.language] ?? 0) + 1;
    if (p.content_type) counts.content_type[p.content_type] = (counts.content_type[p.content_type] ?? 0) + 1;
    if (p.channel_handle) counts.channels[p.channel_handle] = (counts.channels[p.channel_handle] ?? 0) + 1;
    counts.collection[p.collection_id] = (counts.collection[p.collection_id] ?? 0) + 1;
    for (const t of p.themes ?? []) counts.themes[t] = (counts.themes[t] ?? 0) + 1;
    for (const e of p.entities ?? []) counts.entities[e] = (counts.entities[e] ?? 0) + 1;
  }
  return counts;
}

interface FilterPillProps {
  label: string;
  count: number;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  formatLabel?: (value: string) => string;
  colorDot?: (value: string) => string | undefined;
  searchable?: boolean;
  /** Per-option post counts */
  optionCounts?: Record<string, number>;
}

function FilterPill({
  label, count, options, selected, onToggle, onSelectAll, onClearAll: onClearPill,
  formatLabel, colorDot, searchable, optionCounts,
}: FilterPillProps) {
  const [search, setSearch] = useState('');
  const filtered = searchable && search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  const allSelected = options.length > 0 && options.every((o) => selected.includes(o));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
            count > 0
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground',
          )}
        >
          {label}
          {count > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Search */}
        {searchable && (
          <div className="border-b border-border p-2">
            <Input
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        )}
        {/* Select All / Clear */}
        {options.length > 1 && (
          <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={allSelected ? onClearPill : onSelectAll}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            {count > 0 && !allSelected && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                onClick={onClearPill}
              >
                Clear
              </button>
            )}
          </div>
        )}
        <div className="max-h-56 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No options</p>
          )}
          {filtered.map((value) => {
            const dot = colorDot?.(value);
            return (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Checkbox
                  checked={selected.includes(value)}
                  onCheckedChange={() => onToggle(value)}
                  className="h-3.5 w-3.5"
                />
                {dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
                <span className="truncate">{formatLabel ? formatLabel(value) : value}</span>
                {optionCounts && optionCounts[value] != null && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {optionCounts[value].toLocaleString()}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateRangePill({
  dateRange, dateMin, dateMax, onChange,
}: {
  dateRange: { from: string | null; to: string | null };
  dateMin: string | null;
  dateMax: string | null;
  onChange: (range: { from: string | null; to: string | null }) => void;
}) {
  const active = dateRange.from || dateRange.to;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
            active
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground',
          )}
        >
          <Calendar className="h-3 w-3" />
          Date Range
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-medium text-muted-foreground">From</label>
          <Input
            type="date"
            value={dateRange.from || ''}
            min={dateMin || undefined}
            max={dateRange.to || dateMax || undefined}
            onChange={(e) => onChange({ ...dateRange, from: e.target.value || null })}
            className="h-7 text-xs"
          />
          <label className="text-[11px] font-medium text-muted-foreground">To</label>
          <Input
            type="date"
            value={dateRange.to || ''}
            min={dateRange.from || dateMin || undefined}
            max={dateMax || undefined}
            onChange={(e) => onChange({ ...dateRange, to: e.target.value || null })}
            className="h-7 text-xs"
          />
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => onChange({ from: null, to: null })}
            >
              Clear dates
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DashboardFilterBar({
  filters,
  availableOptions,
  activeFilterCount,
  onToggle,
  onSetFilter,
  onClearAll,
  collectionNames,
  isEditMode = false,
  filterBarFilters,
  onFilterBarChange,
  allPosts,
}: DashboardFilterBarProps) {
  const optionCounts = useMemo(() => allPosts ? computeOptionCounts(allPosts) : undefined, [allPosts]);
  // Active filter pill IDs (ordered)
  const activeFilters: FilterBarFilterId[] = (filterBarFilters ?? DEFAULT_FILTER_BAR_FILTERS) as FilterBarFilterId[];

  // ── Scroll with arrow buttons ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkOverflow();
    el.addEventListener('scroll', checkOverflow, { passive: true });
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      observer.disconnect();
    };
  }, [checkOverflow, activeFilters]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -160 : 160, behavior: 'smooth' });
  }, []);

  // ── Drag-and-drop reorder ──
  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverIndexRef.current = index;
  }, []);

  const handleDrop = useCallback(() => {
    const from = dragIndexRef.current;
    const to = dragOverIndexRef.current;
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
    if (from === null || to === null || from === to) return;
    const updated = [...activeFilters];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    onFilterBarChange?.(updated);
  }, [activeFilters, onFilterBarChange]);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
  }, []);

  // ── Add / remove filters ──
  const removeFilter = useCallback((id: FilterBarFilterId) => {
    const updated = activeFilters.filter((f) => f !== id);
    onFilterBarChange?.(updated);
    // Also clear filter value
    if (id === 'date_range') {
      onSetFilter('date_range', { from: null, to: null });
    } else {
      onSetFilter(id as ArrayFilterKey, []);
    }
  }, [activeFilters, onFilterBarChange, onSetFilter]);

  const addFilter = useCallback((id: FilterBarFilterId) => {
    onFilterBarChange?.([...activeFilters, id]);
  }, [activeFilters, onFilterBarChange]);

  const availableToAdd = ALL_FILTER_BAR_IDS.filter((id) => {
    if (activeFilters.includes(id)) return false;
    // Don't offer 'collection' if only one collection
    if (id === 'collection' && availableOptions.collection.length <= 1) return false;
    return true;
  });

  // ── Render a single filter pill ──
  const renderFilter = (id: FilterBarFilterId) => {
    if (id === 'date_range') {
      return (
        <DateRangePill
          dateRange={filters.date_range}
          dateMin={availableOptions.dateMin}
          dateMax={availableOptions.dateMax}
          onChange={(range) => onSetFilter('date_range', range)}
        />
      );
    }

    const optMap: Record<string, { opts: string[]; sel: string[]; format?: (v: string) => string; color?: (v: string) => string | undefined; search?: boolean }> = {
      sentiment: {
        opts: availableOptions.sentiment,
        sel: filters.sentiment,
        format: (v) => v.charAt(0).toUpperCase() + v.slice(1),
        color: (v) => SENTIMENT_COLORS[v],
      },
      emotion: {
        opts: availableOptions.emotion,
        sel: filters.emotion,
        format: (v) => v.charAt(0).toUpperCase() + v.slice(1),
      },
      platform: {
        opts: availableOptions.platform,
        sel: filters.platform,
        format: (v) => PLATFORM_LABELS[v] || v,
      },
      themes: { opts: availableOptions.themes, sel: filters.themes, search: true },
      entities: { opts: availableOptions.entities, sel: filters.entities, search: true },
      language: { opts: availableOptions.language, sel: filters.language },
      content_type: {
        opts: availableOptions.content_type,
        sel: filters.content_type,
        format: (v) => v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' '),
      },
      channels: { opts: availableOptions.channels, sel: filters.channels, search: true },
      collection: {
        opts: availableOptions.collection,
        sel: filters.collection,
        format: (v) => collectionNames?.[v] || v.slice(0, 8),
      },
    };

    const cfg = optMap[id];
    if (!cfg) return null;

    // In view mode, hide filters with no options (unless something is selected)
    if (!isEditMode && cfg.opts.length === 0 && cfg.sel.length === 0) return null;

    const key = id as ArrayFilterKey;
    return (
      <FilterPill
        label={FILTER_LABELS[id]}
        count={cfg.sel.length}
        options={cfg.opts}
        selected={cfg.sel}
        onToggle={(v) => onToggle(key, v)}
        onSelectAll={() => {
          const toAdd = cfg.opts.filter((o) => !cfg.sel.includes(o));
          toAdd.forEach((v) => onToggle(key, v));
        }}
        onClearAll={() => onSetFilter(key, [])}
        formatLabel={cfg.format}
        colorDot={cfg.color}
        searchable={cfg.search}
        optionCounts={optionCounts?.[id]}
      />
    );
  };

  const showArrows = canScrollLeft || canScrollRight;

  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-2.5 min-w-0">
      <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0 hidden sm:block mr-1" />

      {/* Left arrow */}
      {showArrows && (
        <button
          type="button"
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          className="shrink-0 h-6 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-0 transition-opacity"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Filter pills */}
      <div
        ref={scrollRef}
        className={cn(
          'flex items-center gap-2 flex-1 min-w-0 overflow-hidden',
          isEditMode && 'pt-2 pr-1.5 pb-0.5',
        )}
      >
        {activeFilters.map((id, index) => {
          const content = renderFilter(id);
          if (!content && !isEditMode) return null;

          return (
            <div
              key={id}
              className="relative shrink-0 group/filter"
              draggable={isEditMode}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              {isEditMode && (
                <GripVertical className="absolute -left-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover/filter:opacity-100 transition-opacity cursor-grab" />
              )}
              {content ?? (
                <button
                  className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground/50"
                  disabled
                >
                  {FILTER_LABELS[id]}
                </button>
              )}
              {isEditMode && (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 z-10 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/90 transition-colors"
                  onClick={() => removeFilter(id)}
                  title={`Remove ${FILTER_LABELS[id]} filter`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Clear all (view mode) */}
        {activeFilterCount > 0 && !isEditMode && (
          <button
            onClick={onClearAll}
            className="ml-1 flex items-center gap-1 rounded-full border border-destructive/20 px-2 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 shrink-0"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      {/* Right arrow */}
      {showArrows && (
        <button
          type="button"
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          className="shrink-0 h-6 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-0 transition-opacity"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Add filter button (edit mode) */}
      {isEditMode && availableToAdd.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              title="Add filter"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <div className="flex flex-col">
              {availableToAdd.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="flex items-center px-3 py-1.5 text-xs text-left rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => addFilter(id)}
                >
                  {FILTER_LABELS[id]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
