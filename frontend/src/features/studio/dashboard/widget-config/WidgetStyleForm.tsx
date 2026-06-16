import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { CustomChartConfig, CustomDimension, NumberSize, SocialAggregation, TimeBucket, TopValuePart } from '../types-social-dashboard.ts';
import { DATETIME_DIMENSIONS, DEFAULT_NUMBER_SIZE, KPI_OPTIONS, getDimensionMeta } from '../types-social-dashboard.ts';
import { resolveSparklineEnabled } from '../sparkline-visibility.ts';

const TIME_BUCKETS: TimeBucket[] = ['hour', 'day', 'week', 'month'];

const PRESET_COLORS = [
  '#4A7C8F', '#2B5066', '#5A7FA0', '#6B3040', '#9E4A5A',
  '#9A7B3C', '#3E6B52', '#4A5568', '#8B6040', '#6B4A6E',
];

const NUMBER_SIZE_OPTIONS: Array<{ value: NumberSize; label: string }> = [
  { value: 'small',  label: 'Small'  },
  { value: 'medium', label: 'Medium' },
  { value: 'big',    label: 'Big'    },
];

const TOP_VALUE_PART_OPTIONS: Array<{ value: TopValuePart; label: string }> = [
  { value: 'label',   label: 'Value'   },
  { value: 'count',   label: 'Count'   },
  { value: 'percent', label: 'Percent' },
];
const DEFAULT_TOP_VALUE_PARTS: TopValuePart[] = ['label'];

interface WidgetStyleFormProps {
  aggregation: SocialAggregation;
  kpiIndex?: number;
  accent?: string;
  numberSize?: NumberSize;
  showSparkline?: boolean;
  trendDimension?: CustomDimension;
  trendTimeBucket?: TimeBucket;
  trendCumulative?: boolean;
  /** Number-card aggregation - drives the Top-value display control. */
  metricAgg?: CustomChartConfig['metricAgg'];
  topValueParts?: TopValuePart[];
  onKpiIndexChange?: (index: number) => void;
  onAccentChange: (color: string | undefined) => void;
  onNumberSizeChange?: (size: NumberSize) => void;
  onShowSparklineChange?: (show: boolean) => void;
  onTrendDimensionChange?: (dim: CustomDimension) => void;
  onTrendTimeBucketChange?: (bucket: TimeBucket) => void;
  onTrendCumulativeChange?: (cumulative: boolean) => void;
  onTopValuePartsChange?: (parts: TopValuePart[]) => void;
}

export function WidgetStyleForm({
  aggregation,
  kpiIndex,
  accent,
  numberSize,
  showSparkline,
  trendDimension,
  trendTimeBucket,
  trendCumulative,
  metricAgg,
  topValueParts,
  onKpiIndexChange,
  onAccentChange,
  onNumberSizeChange,
  onShowSparklineChange,
  onTrendDimensionChange,
  onTrendTimeBucketChange,
  onTrendCumulativeChange,
  onTopValuePartsChange,
}: WidgetStyleFormProps) {
  const activeTopValueParts = topValueParts?.length ? topValueParts : DEFAULT_TOP_VALUE_PARTS;
  const activeSize = numberSize ?? DEFAULT_NUMBER_SIZE;
  // default the toggle to the per-size behaviour so the checkbox reflects what's rendered
  const sparklineOn = showSparkline ?? resolveSparklineEnabled(activeSize, undefined);
  return (
    <div className="space-y-5">
      {/* Size selector (number-card only) */}
      {onNumberSizeChange && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Size</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {NUMBER_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onNumberSizeChange(opt.value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                  activeSize === opt.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Changing size also resizes the widget on the grid.
          </p>
        </div>
      )}

      {/* Top-value display pieces (mode number-card only) */}
      {metricAgg === 'mode' && onTopValuePartsChange && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Show</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {TOP_VALUE_PART_OPTIONS.map((opt) => {
              const checked = activeTopValueParts.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const next = TOP_VALUE_PART_OPTIONS
                      .map((o) => o.value)
                      .filter((v) => (v === opt.value ? !checked : activeTopValueParts.includes(v)));
                    // Never empty - keep at least the value label.
                    onTopValuePartsChange(next.length ? next : DEFAULT_TOP_VALUE_PARTS);
                  }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                    checked
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Pieces shown on the card, e.g. &ldquo;positive · 1,240 · 31%&rdquo;.
          </p>
        </div>
      )}

      {/* Trendline toggle + X-axis (number-card only) */}
      {onShowSparklineChange && (
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sparklineOn}
              onChange={(e) => onShowSparklineChange(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            Show trendline
          </label>

          {sparklineOn && onTrendDimensionChange && (
            <div className="space-y-2 border-l-2 border-border/60 pl-3">
              {/* X-axis datetime dimension */}
              <div className="flex items-center gap-3">
                <Label className="text-xs w-16 shrink-0 text-muted-foreground">X-axis</Label>
                <Select
                  value={trendDimension ?? 'posted_at'}
                  onValueChange={(v) => onTrendDimensionChange(v as CustomDimension)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATETIME_DIMENSIONS.map((dim) => (
                      <SelectItem key={dim} value={dim} className="text-xs">
                        {getDimensionMeta(dim).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Time bucket */}
              {onTrendTimeBucketChange && (
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-16 shrink-0 text-muted-foreground">Bucket</Label>
                  <div className="flex items-center gap-1.5">
                    {TIME_BUCKETS.map((bucket) => (
                      <button
                        key={bucket}
                        type="button"
                        onClick={() => onTrendTimeBucketChange(bucket)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-all',
                          (trendTimeBucket ?? 'day') === bucket
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                        )}
                      >
                        {bucket}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Cumulative (running total) */}
              {onTrendCumulativeChange && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!trendCumulative}
                    onChange={(e) => onTrendCumulativeChange(e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer"
                  />
                  Cumulative
                </label>
              )}
            </div>
          )}
        </div>
      )}

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
