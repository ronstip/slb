import { Calendar, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import {
  DATE_PRESETS as PRESETS,
  isoToLocalInput,
  localInputToIso,
  formatShort,
  matchPresetLabel,
  type DateTimeRange,
} from './dateRange.ts';

export type { DateTimeRange };

interface DateTimeRangeFilterProps {
  value: DateTimeRange;
  onChange: (range: DateTimeRange) => void;
}

export function DateTimeRangeFilter({ value, onChange }: DateTimeRangeFilterProps) {
  const active = Boolean(value.from || value.to);
  const presetLabel = matchPresetLabel(value);

  let summary: string;
  if (!active) {
    summary = 'All';
  } else if (presetLabel) {
    summary = presetLabel;
  } else {
    summary = `${formatShort(value.from)} → ${formatShort(value.to)}`;
  }

  const applyPreset = (ms: number) => {
    const from = new Date(Date.now() - ms).toISOString();
    onChange({ from, to: null });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs',
            'hover:bg-accent/50 transition-colors',
            active && 'border-primary/40',
          )}
        >
          <Calendar className="h-3 w-3" />
          <span className="text-muted-foreground font-medium">Date:</span>
          <span className={cn('truncate max-w-[180px]', active && 'text-foreground')}>{summary}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Quick ranges</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.ms)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    presetLabel === p.label
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/30',
                  )}
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
                value={isoToLocalInput(value.from)}
                onChange={(e) => onChange({ ...value, from: localInputToIso(e.target.value) })}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                value={isoToLocalInput(value.to)}
                onChange={(e) => onChange({ ...value, to: localInputToIso(e.target.value) })}
                className="h-7 text-xs"
              />
            </div>
          </div>

          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => onChange({ from: null, to: null })}
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
