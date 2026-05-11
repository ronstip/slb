import { useMemo } from 'react';
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
import type { CustomChartConfig, CustomDimension, CustomMetric, SocialChartType } from '../types-social-dashboard.ts';
import {
  DIMENSION_META,
  METRIC_META,
  getDimensionMeta,
  getValidChartTypesForCustom,
  CUSTOM_DIM_PREFIX,
} from '../types-social-dashboard.ts';

const STANDARD_DIMENSIONS = Object.keys(DIMENSION_META) as CustomDimension[];
const ALL_METRICS = Object.keys(METRIC_META) as CustomMetric[];

const AGG_OPTIONS: Array<{ value: CustomChartConfig['metricAgg']; label: string }> = [
  { value: 'sum', label: 'Total (Sum)' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count' },
];

interface DataSourceFormProps {
  config: CustomChartConfig;
  onChange: (config: CustomChartConfig) => void;
  onChartTypeChange: (type: SocialChartType) => void;
  /** Current chart type — drives which controls are relevant (e.g. stacked only
   *  applies to bar). */
  chartType: SocialChartType;
  /**
   * Names of custom enrichment fields available on the dataset. Surfaced as
   * `custom:<name>` group-by dimensions.
   */
  customFieldNames?: string[];
}

export function DataSourceForm({ config, onChange, onChartTypeChange, chartType, customFieldNames }: DataSourceFormProps) {
  const allDimensions = useMemo<CustomDimension[]>(() => {
    const customDims = (customFieldNames ?? []).map(
      (n) => `${CUSTOM_DIM_PREFIX}${n}` as CustomDimension,
    );
    return [...STANDARD_DIMENSIONS, ...customDims];
  }, [customFieldNames]);

  const handleMetricChange = (metric: CustomMetric) => {
    const next: CustomChartConfig = { ...config, metric };
    // Ensure chart type is still valid
    const validTypes = getValidChartTypesForCustom(config.dimension, metric);
    onChartTypeChange(validTypes[0]);
    onChange(next);
  };

  const handleDimensionChange = (dimension: CustomDimension | undefined) => {
    const next: CustomChartConfig = { ...config, dimension };
    // Reset timeBucket when not on date
    if (dimension !== 'posted_at') {
      delete next.timeBucket;
    } else if (!next.timeBucket) {
      next.timeBucket = 'day';
    }
    // Clear breakdown if it conflicts with the new dimension
    if (!dimension || dimension === 'posted_at' || next.breakdownDimension === dimension) {
      delete next.breakdownDimension;
    }
    // Ensure chart type is valid for new dimension
    const validTypes = getValidChartTypesForCustom(dimension, config.metric);
    if (!validTypes.includes(config.metric as unknown as SocialChartType)) {
      onChartTypeChange(validTypes[0]);
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {/* Metric */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Metric</Label>
        <Select
          value={config.metric}
          onValueChange={(v) => handleMetricChange(v as CustomMetric)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_METRICS.map((metric) => (
              <SelectItem key={metric} value={metric}>
                {METRIC_META[metric].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Aggregation — visible whenever there's a dimension */}
      {config.dimension && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Aggregation</Label>
          <Select
            value={config.metricAgg ?? 'sum'}
            onValueChange={(v) => onChange({ ...config, metricAgg: v as CustomChartConfig['metricAgg'] })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGG_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value!}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Group By */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Group By</Label>
        <Select
          value={config.dimension ?? 'none'}
          onValueChange={(v) =>
            handleDimensionChange(v === 'none' ? undefined : (v as CustomDimension))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (single value)</SelectItem>
            {allDimensions.map((dim) => (
              <SelectItem key={dim} value={dim}>
                {getDimensionMeta(dim).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Breakdown (hue) — available for any primary dimension */}
      {config.dimension && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Breakdown</Label>
          <Select
            value={config.breakdownDimension ?? 'none'}
            onValueChange={(v) =>
              onChange({ ...config, breakdownDimension: v === 'none' ? undefined : (v as CustomDimension) })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {allDimensions.filter((d) => d !== config.dimension && d !== 'posted_at').map((dim) => (
                <SelectItem key={dim} value={dim}>
                  {getDimensionMeta(dim).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Time bucket (only when grouped by posted_at) */}
      {config.dimension === 'posted_at' && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Time Bucket</Label>
          <div className="flex items-center gap-1.5">
            {(['day', 'week', 'month'] as const).map((bucket) => (
              <button
                key={bucket}
                type="button"
                onClick={() => onChange({ ...config, timeBucket: bucket })}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-all capitalize',
                  config.timeBucket === bucket
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

      {/* Stacked vs grouped — bar only, when a breakdown is set */}
      {chartType === 'bar' && config.breakdownDimension && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Bars</Label>
          <div className="flex items-center gap-1.5">
            {([
              { v: true, label: 'Stacked' },
              { v: false, label: 'Side by side' },
            ] as const).map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => onChange({ ...config, stacked: opt.v })}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-all',
                  (config.stacked ?? true) === opt.v
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Optional viewer-facing metric toggle (header chips on the widget) */}
      {config.dimension && (
        <div className="flex items-start gap-3">
          <Label className="text-xs w-24 shrink-0 pt-1.5">Quick toggle</Label>
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {ALL_METRICS.map((m) => {
                const checked = config.metricToggle?.includes(m) ?? false;
                const isPrimary = m === config.metric;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const current = new Set(config.metricToggle ?? []);
                      if (current.has(m)) current.delete(m);
                      else current.add(m);
                      // Always include the primary metric if any other is checked.
                      if (current.size > 0) current.add(config.metric);
                      const next = current.size >= 2 ? Array.from(current) : undefined;
                      onChange({ ...config, metricToggle: next });
                    }}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all',
                      checked
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                      isPrimary && 'ring-1 ring-primary/20',
                    )}
                    title={isPrimary ? 'Primary metric (always included when toggle is on)' : METRIC_META[m].description}
                  >
                    {METRIC_META[m].label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pick 2+ metrics to expose a header switch on the widget.
            </p>
          </div>
        </div>
      )}

      {/* Top N + include Others — categorical primary or time+breakdown */}
      {config.dimension && (
        <div className="flex items-start gap-3">
          <Label className="text-xs w-24 shrink-0 pt-1.5">
            {config.dimension === 'posted_at' ? 'Top series' : 'Top N'}
          </Label>
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={config.topN ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    onChange({ ...config, topN: undefined, includeOthers: undefined });
                    return;
                  }
                  const n = Math.max(1, Math.min(100, Math.floor(Number(raw))));
                  if (!Number.isFinite(n)) return;
                  onChange({ ...config, topN: n });
                }}
                placeholder="All"
                className="h-8 w-20 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                {config.dimension === 'posted_at' ? 'series' : 'categories'}
              </span>
            </div>
            {/* Others toggle: only meaningful when topN is set AND primary is categorical
             *  (time series "Others" rolls tail series into one extra line). */}
            {config.topN !== undefined && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!config.includeOthers}
                  onChange={(e) => onChange({ ...config, includeOthers: e.target.checked })}
                  className="h-3.5 w-3.5 cursor-pointer"
                />
                Include &ldquo;Others&rdquo; bucket
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
