import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { SocialAggregation } from '../types-social-dashboard.ts';
import { KPI_OPTIONS } from '../types-social-dashboard.ts';

const PRESET_COLORS = [
  '#4A7C8F', '#2B5066', '#5A7FA0', '#6B3040', '#9E4A5A',
  '#9A7B3C', '#3E6B52', '#4A5568', '#8B6040', '#6B4A6E',
];

interface WidgetStyleFormProps {
  aggregation: SocialAggregation;
  kpiIndex?: number;
  accent?: string;
  onKpiIndexChange?: (index: number) => void;
  onAccentChange: (color: string | undefined) => void;
}

export function WidgetStyleForm({
  aggregation,
  kpiIndex,
  accent,
  onKpiIndexChange,
  onAccentChange,
}: WidgetStyleFormProps) {
  return (
    <div className="space-y-5">
      {/* KPI selector (only for kpi aggregation) */}
      {aggregation === 'kpi' && onKpiIndexChange && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">KPI Metric</Label>
          <div className="grid grid-cols-1 gap-1.5">
            {KPI_OPTIONS.map((opt) => (
              <button
                key={opt.index}
                type="button"
                onClick={() => onKpiIndexChange(opt.index)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all',
                  kpiIndex === opt.index
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: opt.accent }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Accent color */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Accent Color</Label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onAccentChange(color)}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                accent === color ? 'border-foreground scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
          <button
            type="button"
            onClick={() => onAccentChange(undefined)}
            className={cn(
              'h-7 w-7 rounded-full border-2 text-[10px] font-medium text-muted-foreground transition-all hover:scale-110',
              !accent ? 'border-foreground scale-110 bg-muted' : 'border-dashed border-border bg-muted/50',
            )}
            title="Auto (theme colors)"
          >
            A
          </button>
        </div>

        {/* Custom color input */}
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: accent ?? '#4A7C8F' }}
          />
          <Input
            type="color"
            className="h-7 w-14 cursor-pointer p-0.5"
            value={accent ?? '#4A7C8F'}
            onChange={(e) => onAccentChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">Custom color</span>
        </div>
      </div>
    </div>
  );
}
