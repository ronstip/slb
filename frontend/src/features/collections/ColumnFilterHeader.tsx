import { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, Filter, Search, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { cn } from '../../lib/utils.ts';
import {
  DATE_PRESETS,
  isoToLocalInput,
  localInputToIso,
} from './dateRange.ts';

/* ------------------------------------------------------------------ */
/* Shared trigger styling - keeps the "this column is filterable"      */
/* affordance consistent across every header kind.                     */
/* ------------------------------------------------------------------ */

const TRIGGER_BASE =
  'inline-flex items-center gap-1 rounded px-1 -mx-1 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-accent/60';

/** Faint funnel shown when a column has no active filter - signals filterability. */
function FilterAffordance({ active }: { active: boolean }) {
  return (
    <Filter className={cn('h-3 w-3', active ? '' : 'opacity-40')} />
  );
}

/* ------------------------------------------------------------------ */
/* Multi-select filter header (with search + counts)                   */
/* ------------------------------------------------------------------ */

export interface FilterOption {
  value: string;
  count: number;
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  renderOption?: (option: string, count: number) => React.ReactNode;
}

/**
 * The popover *body* of a multi-select filter: search box, scrollable list of
 * values with per-value counts + an "Only" affordance, and Select All / Clear
 * actions. Extracted from MultiSelectFilterHeader so it can be reused outside
 * a column header (e.g. the widget config dialog's Filters tab) with a
 * different trigger. Single source of truth for the list UI.
 */
export function MultiSelectFilterBody({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: MultiSelectFilterProps) {
  const [search, setSearch] = useState('');
  const hasFilter = selected.size > 0;

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const selectAll = () => {
    onChange(new Set(filtered.map((o) => o.value)));
  };

  const selectOnly = (value: string) => {
    onChange(new Set([value]));
  };

  return (
    <>
      {/* Search within filter */}
      {options.length > 5 && (
        <div className="shrink-0 border-b border-border/40 p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
      )}

      {/* Scrollable options list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">No matches</div>
          ) : (
            filtered.map((opt) => {
              const isChecked = selected.has(opt.value);
              return (
                <label
                  key={opt.value}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors',
                    isChecked
                      ? 'bg-primary/8 text-foreground'
                      : 'hover:bg-accent text-foreground/80',
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="flex-1 min-w-0 truncate">
                    {renderOption
                      ? renderOption(opt.value, opt.count)
                      : <span className="capitalize">{opt.value}</span>}
                  </span>
                  {/* "Only" - clears every other value, keeps just this one. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectOnly(opt.value);
                    }}
                    className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                  >
                    Only
                  </button>
                  <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {opt.count.toLocaleString()}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* Action buttons - pinned at bottom */}
      <div className="shrink-0 flex items-center gap-1.5 border-t border-border/40 px-2 py-1.5 bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          className="h-6 flex-1 text-[10px] font-semibold"
          onClick={selectAll}
        >
          Select All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 flex-1 text-[10px] font-semibold text-muted-foreground"
          onClick={() => onChange(new Set())}
          disabled={!hasFilter}
        >
          Clear
        </Button>
      </div>
    </>
  );
}

export function MultiSelectFilterHeader(props: MultiSelectFilterProps) {
  const hasFilter = props.selected.size > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TRIGGER_BASE,
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {props.label}
          {hasFilter ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {props.selected.size}
            </span>
          ) : (
            <FilterAffordance active={false} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-56 max-h-80 flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <MultiSelectFilterBody {...props} />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Text search filter header                                           */
/* ------------------------------------------------------------------ */

interface TextFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/* ------------------------------------------------------------------ */
/* Number range filter header (min / max)                              */
/* ------------------------------------------------------------------ */

export interface NumberRange {
  min?: number;
  max?: number;
}

interface NumberRangeFilterProps {
  label: string;
  value: NumberRange;
  onChange: (value: NumberRange) => void;
}

export function NumberRangeFilterHeader({ label, value, onChange }: NumberRangeFilterProps) {
  const hasFilter = value.min != null || value.max != null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TRIGGER_BASE,
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          <FilterAffordance active={hasFilter} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            value={value.min == null ? '' : value.min}
            onChange={(e) => onChange({ ...value, min: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="min"
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            value={value.max == null ? '' : value.max}
            onChange={(e) => onChange({ ...value, max: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="max"
            className="h-7 text-xs"
          />
        </div>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-full text-[10px] text-muted-foreground"
            onClick={() => onChange({})}
          >
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Bool filter header (true / false / any)                             */
/* ------------------------------------------------------------------ */

interface BoolFilterProps {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}

export function BoolFilterHeader({ label, value, onChange }: BoolFilterProps) {
  const hasFilter = value !== undefined;
  const display = value === undefined ? 'any' : value === true ? 'true' : 'false';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TRIGGER_BASE,
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          <FilterAffordance active={hasFilter} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-32 p-1.5" onClick={(e) => e.stopPropagation()}>
        <Select
          value={display}
          onValueChange={(v) => onChange(v === 'any' ? undefined : v === 'true')}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any" className="text-xs">Any</SelectItem>
            <SelectItem value="true" className="text-xs">True</SelectItem>
            <SelectItem value="false" className="text-xs">False</SelectItem>
          </SelectContent>
        </Select>
      </PopoverContent>
    </Popover>
  );
}

export function TextFilterHeader({ label, value, onChange }: TextFilterProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFilter = value.length > 0;

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TRIGGER_BASE,
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          <FilterAffordance active={hasFilter} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Filter ${label.toLowerCase()}...`}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5 h-6 w-full text-[10px] text-muted-foreground"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <X className="mr-1 h-3 w-3" /> Clear filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Date-range filter header (presets + from / to)                      */
/* ------------------------------------------------------------------ */

export interface DateRange {
  from?: string; // ISO
  to?: string;   // ISO
}

interface DateRangeFilterProps {
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
}

export function DateRangeFilterHeader({ label, value, onChange }: DateRangeFilterProps) {
  const hasFilter = Boolean(value.from || value.to);

  const applyPreset = (ms: number) => {
    onChange({ from: new Date(Date.now() - ms).toISOString(), to: undefined });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            TRIGGER_BASE,
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          {hasFilter ? <Calendar className="h-3 w-3" /> : <FilterAffordance active={false} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Quick ranges</div>
            <div className="flex flex-wrap gap-1.5">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.ms)}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                value={isoToLocalInput(value.from ?? null)}
                onChange={(e) => onChange({ ...value, from: localInputToIso(e.target.value) ?? undefined })}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                value={isoToLocalInput(value.to ?? null)}
                onChange={(e) => onChange({ ...value, to: localInputToIso(e.target.value) ?? undefined })}
                className="h-7 text-xs"
              />
            </div>
          </div>

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => onChange({ from: undefined, to: undefined })}
            >
              <X className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
