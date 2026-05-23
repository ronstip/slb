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
import type {
  AnyDimension,
  AnyMetric,
  CustomChartConfig,
  CustomDimension,
  CustomMetric,
  DataSource,
  SocialChartType,
  TopicDimension,
  TopicMetric,
} from '../types-social-dashboard.ts';
import {
  CUSTOM_DIM_PREFIX,
  DIMENSION_META,
  METRIC_META,
  TOPIC_DIMENSION_META,
  TOPIC_JSON_UNNESTED_DIMENSIONS,
  TOPIC_METRIC_META,
  TOPIC_RATIO_METRICS,
  getDimensionMeta,
  getTopicDimensionMeta,
  getValidChartTypesForCustom,
} from '../types-social-dashboard.ts';

const STANDARD_DIMENSIONS = Object.keys(DIMENSION_META) as CustomDimension[];
const ALL_POST_METRICS = Object.keys(METRIC_META) as CustomMetric[];
const TOPIC_DIMENSIONS = Object.keys(TOPIC_DIMENSION_META) as TopicDimension[];
const ALL_TOPIC_METRICS = Object.keys(TOPIC_METRIC_META) as TopicMetric[];

const AGG_OPTIONS: Array<{ value: CustomChartConfig['metricAgg']; label: string }> = [
  { value: 'sum', label: 'Total (Sum)' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count' },
];

const RATIO_AGG_OPTIONS = AGG_OPTIONS.filter(
  (o) => o.value === 'avg' || o.value === 'min' || o.value === 'max',
);

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
  /** Which BigQuery source the widget reads. Default 'posts'. The widget-level
   *  Data Source toggle lives in the dialog, not the form. */
  dataSource?: DataSource;
}

export function DataSourceForm({
  config,
  onChange,
  onChartTypeChange,
  chartType,
  customFieldNames,
  dataSource = 'posts',
}: DataSourceFormProps) {
  const isTopics = dataSource === 'topics';
  const isJsonUnnestedTopicDim =
    isTopics && TOPIC_JSON_UNNESTED_DIMENSIONS.has(config.dimension as TopicDimension);

  const allPostDimensions = useMemo<CustomDimension[]>(() => {
    const customDims = (customFieldNames ?? []).map(
      (n) => `${CUSTOM_DIM_PREFIX}${n}` as CustomDimension,
    );
    return [...STANDARD_DIMENSIONS, ...customDims];
  }, [customFieldNames]);

  const metricMeta = isTopics ? TOPIC_METRIC_META : METRIC_META;
  const allMetrics: AnyMetric[] = isTopics ? ALL_TOPIC_METRICS : ALL_POST_METRICS;
  const allDimensions: AnyDimension[] = isTopics ? TOPIC_DIMENSIONS : allPostDimensions;
  const renderDimMeta = (dim: AnyDimension) =>
    isTopics ? getTopicDimensionMeta(dim as TopicDimension) : getDimensionMeta(dim as CustomDimension);

  const handleMetricChange = (metric: AnyMetric) => {
    const next: CustomChartConfig = { ...config, metric };
    if (isTopics) {
      // Ratio metrics can't decompose per breakdown entry → block JSON-unnested
      // dims when the user lands on a ratio. Falls back to `topic` dim.
      if (
        TOPIC_RATIO_METRICS.has(metric as TopicMetric) &&
        TOPIC_JSON_UNNESTED_DIMENSIONS.has(next.dimension as TopicDimension)
      ) {
        next.dimension = 'topic';
      }
      // Reset metricAgg when switching between ratio/non-ratio metrics so the
      // old aggregation doesn't carry over into a non-meaningful state.
      delete next.metricAgg;
    } else {
      const validTypes = getValidChartTypesForCustom(config.dimension as CustomDimension | undefined, metric as CustomMetric);
      onChartTypeChange(validTypes[0]);
    }
    onChange(next);
  };

  const handleDimensionChange = (dimension: AnyDimension | undefined) => {
    const next: CustomChartConfig = { ...config, dimension };
    if (isTopics) {
      // Topics: no time bucket, no breakdown in phase 1.
      delete next.timeBucket;
      delete next.breakdownDimension;
    } else {
      if (dimension !== 'posted_at') {
        delete next.timeBucket;
      } else if (!next.timeBucket) {
        next.timeBucket = 'day';
      }
      if (!dimension || dimension === 'posted_at' || next.breakdownDimension === dimension) {
        delete next.breakdownDimension;
      }
      const validTypes = getValidChartTypesForCustom(dimension as CustomDimension | undefined, config.metric as CustomMetric);
      if (!validTypes.includes(config.metric as unknown as SocialChartType)) {
        onChartTypeChange(validTypes[0]);
      }
    }
    onChange(next);
  };

  const aggOptions = isTopics && TOPIC_RATIO_METRICS.has(config.metric as TopicMetric)
    ? RATIO_AGG_OPTIONS
    : AGG_OPTIONS;

  return (
    <div className="space-y-3">
      {/* Metric */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Metric</Label>
        <Select
          value={config.metric as string}
          onValueChange={(v) => handleMetricChange(v as AnyMetric)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allMetrics.map((metric) => (
              <SelectItem key={metric} value={metric}>
                {metricMeta[metric as keyof typeof metricMeta]?.label ?? metric}
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
            value={config.metricAgg ?? (isTopics && TOPIC_RATIO_METRICS.has(config.metric as TopicMetric) ? 'avg' : 'sum')}
            onValueChange={(v) => onChange({ ...config, metricAgg: v as CustomChartConfig['metricAgg'] })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aggOptions.map((opt) => (
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
          value={(config.dimension as string | undefined) ?? 'none'}
          onValueChange={(v) =>
            handleDimensionChange(v === 'none' ? undefined : (v as AnyDimension))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (single value)</SelectItem>
            {allDimensions.map((dim) => {
              const disabled =
                isTopics &&
                TOPIC_RATIO_METRICS.has(config.metric as TopicMetric) &&
                TOPIC_JSON_UNNESTED_DIMENSIONS.has(dim as TopicDimension);
              return (
                <SelectItem
                  key={dim as string}
                  value={dim as string}
                  disabled={disabled}
                >
                  {renderDimMeta(dim).label}
                  {disabled ? ' (not supported with ratio metrics)' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Breakdown (hue) — posts-mode only; topics defer breakdown to phase 2 */}
      {!isTopics && config.dimension && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Breakdown</Label>
          <Select
            value={(config.breakdownDimension as string | undefined) ?? 'none'}
            onValueChange={(v) =>
              onChange({ ...config, breakdownDimension: v === 'none' ? undefined : (v as CustomDimension) })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {allPostDimensions.filter((d) => d !== config.dimension && d !== 'posted_at').map((dim) => (
                <SelectItem key={dim} value={dim}>
                  {getDimensionMeta(dim).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Time bucket — posts-mode only (topic_metrics is a snapshot) */}
      {!isTopics && config.dimension === 'posted_at' && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Time Bucket</Label>
          <div className="flex items-center gap-1.5">
            {(['hour', 'day', 'week', 'month'] as const).map((bucket) => (
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
      {!isTopics && chartType === 'bar' && config.breakdownDimension && (
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
              {allMetrics.map((m) => {
                const checked = config.metricToggle?.includes(m) ?? false;
                const isPrimary = m === config.metric;
                return (
                  <button
                    key={m as string}
                    type="button"
                    onClick={() => {
                      const current = new Set(config.metricToggle ?? []);
                      if (current.has(m)) current.delete(m);
                      else current.add(m);
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
                    title={
                      isPrimary
                        ? 'Primary metric (always included when toggle is on)'
                        : metricMeta[m as keyof typeof metricMeta]?.description ?? ''
                    }
                  >
                    {metricMeta[m as keyof typeof metricMeta]?.label ?? (m as string)}
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
                {config.dimension === 'posted_at' ? 'series' : isJsonUnnestedTopicDim ? 'values' : 'categories'}
              </span>
            </div>
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
