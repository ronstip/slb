import { useMemo } from 'react';
import { Label } from '../../../../components/ui/label.tsx';
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
  /**
   * Names of custom enrichment fields available on the dataset. Surfaced as
   * `custom:<name>` group-by dimensions.
   */
  customFieldNames?: string[];
}

export function DataSourceForm({ config, onChange, onChartTypeChange, customFieldNames }: DataSourceFormProps) {
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

      {/* Breakdown (hue) — only when a non-time primary dimension is set */}
      {config.dimension && config.dimension !== 'posted_at' && (
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
    </div>
  );
}
