import { useState } from 'react';
import { X, Filter, Calendar } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover.tsx';
import { Checkbox } from '../../../components/ui/checkbox.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { cn } from '../../../lib/utils.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { DashboardFilters, FilterOptions } from './use-dashboard-filters.ts';

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

interface DashboardFilterBarProps {
  filters: DashboardFilters;
  availableOptions: FilterOptions;
  activeFilterCount: number;
  onToggle: (key: ArrayFilterKey, value: string) => void;
  onSetFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  onClearAll: () => void;
  collectionNames?: Record<string, string>;
}

interface FilterPillProps {
  label: string;
  count: number;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  formatLabel?: (value: string) => string;
  colorDot?: (value: string) => string | undefined;
  searchable?: boolean;
}

function FilterPill({ label, count, options, selected, onToggle, formatLabel, colorDot, searchable }: FilterPillProps) {
  const [search, setSearch] = useState('');
  const filtered = searchable && search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
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
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateRangePill({
  dateRange,
  dateMin,
  dateMax,
  onChange,
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
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
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
}: DashboardFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />

      <FilterPill
        label="Sentiment"
        count={filters.sentiment.length}
        options={availableOptions.sentiment}
        selected={filters.sentiment}
        onToggle={(v) => onToggle('sentiment', v)}
        colorDot={(v) => SENTIMENT_COLORS[v]}
        formatLabel={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
      />

      <FilterPill
        label="Platform"
        count={filters.platform.length}
        options={availableOptions.platform}
        selected={filters.platform}
        onToggle={(v) => onToggle('platform', v)}
        formatLabel={(v) => PLATFORM_LABELS[v] || v}
      />

      <DateRangePill
        dateRange={filters.date_range}
        dateMin={availableOptions.dateMin}
        dateMax={availableOptions.dateMax}
        onChange={(range) => onSetFilter('date_range', range)}
      />

      <FilterPill
        label="Themes"
        count={filters.themes.length}
        options={availableOptions.themes}
        selected={filters.themes}
        onToggle={(v) => onToggle('themes', v)}
        searchable
      />

      <FilterPill
        label="Entities"
        count={filters.entities.length}
        options={availableOptions.entities}
        selected={filters.entities}
        onToggle={(v) => onToggle('entities', v)}
        searchable
      />

      <FilterPill
        label="Language"
        count={filters.language.length}
        options={availableOptions.language}
        selected={filters.language}
        onToggle={(v) => onToggle('language', v)}
      />

      <FilterPill
        label="Content Type"
        count={filters.content_type.length}
        options={availableOptions.content_type}
        selected={filters.content_type}
        onToggle={(v) => onToggle('content_type', v)}
        formatLabel={(v) => v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ')}
      />

      <FilterPill
        label="Channels"
        count={filters.channels.length}
        options={availableOptions.channels}
        selected={filters.channels}
        onToggle={(v) => onToggle('channels', v)}
        searchable
      />

      {(collectionNames && availableOptions.collection.length > 1) && (
        <FilterPill
          label="Collection"
          count={filters.collection.length}
          options={availableOptions.collection}
          selected={filters.collection}
          onToggle={(v) => onToggle('collection', v)}
          formatLabel={(v) => collectionNames[v] || v.slice(0, 8)}
        />
      )}

      {activeFilterCount > 0 && (
        <button
          onClick={onClearAll}
          className="ml-1 flex items-center gap-1 rounded-full border border-destructive/20 px-2 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="h-3 w-3" />
          Clear all
        </button>
      )}
    </div>
  );
}
