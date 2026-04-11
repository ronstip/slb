import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Filter, Search, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';

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

export function MultiSelectFilterHeader({
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

  const totalSelected = selected.size;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          {hasFilter ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {totalSelected}
            </span>
          ) : (
            <ChevronDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-56 max-h-80 flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
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
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors',
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
                    <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {opt.count.toLocaleString()}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Action buttons — pinned at bottom */}
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
            'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
            hasFilter ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
          {hasFilter ? (
            <Filter className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3 opacity-40" />
          )}
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
