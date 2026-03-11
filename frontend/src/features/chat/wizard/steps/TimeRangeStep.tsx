import { RefreshCw } from 'lucide-react';
import { Switch } from '../../../../components/ui/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { SCHEDULE_UTC_TIMES } from '../../../../lib/constants.ts';
import type { WizardData, StepProps } from '../WizardTypes.ts';

const TIME_RANGES = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

const POSTS_OPTIONS = [10, 20, 50, 100];

interface TimeRangeStepProps {
  data: WizardData;
  updateData: (partial: Partial<WizardData>) => void;
  stepProps: StepProps;
}

export function TimeRangeStep({ data, updateData, stepProps }: TimeRangeStepProps) {
  return (
    <div className="space-y-5">
      {/* Time range */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Time range
        </label>
        <div className="flex flex-wrap gap-2">
          {TIME_RANGES.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateData({ timeRangeDays: value })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                data.timeRangeDays === value
                  ? 'bg-accent-vibrant text-white shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:border-accent-vibrant/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Posts per keyword */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Posts per keyword
        </label>
        <Select
          value={String(data.maxPostsPerKeyword)}
          onValueChange={(v) => updateData({ maxPostsPerKeyword: Number(v) })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POSTS_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} posts</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ongoing Monitoring (optional) */}
      {stepProps.showOngoing && (
        <div className={`rounded-lg border px-4 py-3 transition-colors ${
          data.ongoing
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-border bg-muted/30'
        }`}>
          <div className="flex items-center gap-3">
            <Switch
              checked={data.ongoing}
              onCheckedChange={(checked) => updateData({ ongoing: checked })}
            />
            <div className="flex items-center gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${data.ongoing ? 'text-emerald-600' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${data.ongoing ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
                Ongoing Monitoring
              </span>
            </div>
          </div>
          {data.ongoing && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={data.scheduleIntervalDays}
                  onChange={(e) => updateData({ scheduleIntervalDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
                  className="w-14 rounded border border-input bg-card px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground">
                  {data.scheduleIntervalDays === 1 ? 'day' : 'days'} at
                </span>
                <Select value={data.scheduleTimeUtc} onValueChange={(v) => updateData({ scheduleTimeUtc: v })}>
                  <SelectTrigger className="w-28 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_UTC_TIMES.map(({ label, value }) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">UTC</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
