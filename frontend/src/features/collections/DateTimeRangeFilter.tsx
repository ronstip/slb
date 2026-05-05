import { Calendar, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';

export interface DateTimeRange {
  from: string | null;
  to: string | null;
}

interface DateTimeRangeFilterProps {
  value: DateTimeRange;
  onChange: (range: DateTimeRange) => void;
}

const PRESETS: { label: string; ms: number }[] = [
  { label: 'Last 1h', ms: 60 * 60 * 1000 },
  { label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last 30d', ms: 30 * 24 * 60 * 60 * 1000 },
];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatShort(iso: string | null): string {
  if (!iso) return '…';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchPresetLabel(value: DateTimeRange): string | null {
  if (!value.from || value.to) return null;
  const fromMs = new Date(value.from).getTime();
  const now = Date.now();
  const delta = now - fromMs;
  const tolerance = 60 * 1000;
  const hit = PRESETS.find((p) => Math.abs(delta - p.ms) < tolerance);
  return hit ? hit.label : null;
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
