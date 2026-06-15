import { useMemo } from 'react';
import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { CustomFieldDef } from '../../../../api/types.ts';
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
  OBJECT_METRIC_PREFIX,
  OBJECT_COUNT_LEAF,
  TOPIC_DIMENSION_META,
  TOPIC_JSON_UNNESTED_DIMENSIONS,
  TOPIC_METRIC_META,
  TOPIC_RATIO_METRICS,
  defaultAggForObjectMetric,
  getDimensionMeta,
  getObjectMetricLabel,
  getTopicDimensionMeta,
  getValidChartTypesForCustom,
  isObjectFieldDimension,
  isObjectMetric,
  objectDimsForDef,
  objectFieldOf,
  objectMetricGroupsForDef,
  parseObjectDim,
  parseObjectMetric,
} from '../types-social-dashboard.ts';

/** Title-case a raw field name for display (e.g. `men` → "Men"). */
function humanizeField(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

// Inherited post metrics support sum/avg/min/max (count would just count elements).
const INHERITED_AGG_OPTIONS = AGG_OPTIONS.filter((o) => o.value !== 'count');


interface DataSourceFormProps {
  config: CustomChartConfig;
  onChange: (config: CustomChartConfig) => void;
  onChartTypeChange: (type: SocialChartType) => void;
  /** Current chart type - drives which controls are relevant (e.g. stacked only
   *  applies to bar). */
  chartType: SocialChartType;
  /**
   * Names of custom enrichment fields available on the dataset. Surfaced as
   * `custom:<name>` group-by dimensions.
   */
  customFieldNames?: string[];
  /** Declared list[object] field defs - source of typed object-leaf
   *  dimensions/metrics. */
  objectFieldDefs?: CustomFieldDef[];
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
  objectFieldDefs,
  dataSource = 'posts',
}: DataSourceFormProps) {
  const isTopics = dataSource === 'topics';
  const isJsonUnnestedTopicDim =
    isTopics && TOPIC_JSON_UNNESTED_DIMENSIONS.has(config.dimension as TopicDimension);

  // Element-as-unit object mode: a `customobj:` metric or `custom:field.leaf`
  // dimension is active. When active, the metric + group-by vocabularies SWAP to
  // this field's object tokens (never mixed with post metrics, which would fan a
  // post's engagement out across its N elements).
  const activeObjField = !isTopics ? objectFieldOf(config) : null;
  const activeObjDef = activeObjField
    ? (objectFieldDefs ?? []).find((d) => d.name === activeObjField)
    : undefined;
  const objKind = isObjectMetric(config.metric)
    ? parseObjectMetric(config.metric as string)?.kind ?? null
    : null;
  // own numeric leaf / inherited post metric take an aggregation; count and
  // distinct-posts do not.
  const isObjAggMetric = objKind === 'own' || objKind === 'inherited';

  const allPostDimensions = useMemo<CustomDimension[]>(() => {
    // list[object] fields aggregate element-as-unit, never as a scalar post
    // dimension - reading one as a scalar yields "[object Object]". Exclude them.
    const objectFieldNames = new Set((objectFieldDefs ?? []).map((d) => d.name));
    const customDims = (customFieldNames ?? [])
      .filter((n) => !objectFieldNames.has(n))
      .map((n) => `${CUSTOM_DIM_PREFIX}${n}` as CustomDimension);
    return [...STANDARD_DIMENSIONS, ...customDims];
  }, [customFieldNames, objectFieldDefs]);

  const metricMeta = isTopics ? TOPIC_METRIC_META : METRIC_META;
  const labelForMetric = (m: AnyMetric): string =>
    isObjectMetric(m)
      ? getObjectMetricLabel(m as string)
      : metricMeta[m as keyof typeof metricMeta]?.label ?? (m as string);

  // In object mode the Metric dropdown is grouped (Count / field fields /
  // Inherited from post); other modes use a flat list.
  const objMetricGroups = activeObjDef ? objectMetricGroupsForDef(activeObjDef) : null;
  const allMetrics: AnyMetric[] = isTopics
    ? ALL_TOPIC_METRICS
    : activeObjField
      ? (objMetricGroups
          ? objMetricGroups.flatMap((g) => g.metrics)
          : [config.metric]) // object token active but defs unavailable (shared dashboard)
      : ALL_POST_METRICS;
  const renderDimMeta = (dim: AnyDimension) =>
    isTopics ? getTopicDimensionMeta(dim as TopicDimension) : getDimensionMeta(dim as CustomDimension);

  // Dimension vocabularies, as labeled groups for the Select. In object mode the
  // element is the unit, but it can be grouped/broken-down by a leaf of this
  // field ("This field") OR an inherited post field ("Post fields") - each
  // element borrows its parent post's value. Post/topic modes use a single
  // unlabeled group.
  const objectLeafDims: AnyDimension[] = activeObjDef ? objectDimsForDef(activeObjDef) : [];
  const groupByGroups: Array<{ label: string | null; dims: AnyDimension[] }> = (
    isTopics
      ? [{ label: null, dims: TOPIC_DIMENSIONS as AnyDimension[] }]
      : activeObjField
        ? [
            { label: 'This field', dims: objectLeafDims },
            { label: 'Post fields', dims: allPostDimensions as AnyDimension[] },
          ]
        : [{ label: null, dims: allPostDimensions as AnyDimension[] }]
  ).filter((g) => g.dims.length > 0);

  // Breakdown (hue) excludes the active group-by; post mode also excludes the
  // time axis (it belongs on the primary axis there).
  const breakdownGroups: Array<{ label: string | null; dims: AnyDimension[] }> = (
    isTopics
      ? []
      : activeObjField
        ? [
            { label: 'This field', dims: objectLeafDims.filter((d) => d !== config.dimension) },
            { label: 'Post fields', dims: (allPostDimensions as AnyDimension[]).filter((d) => d !== config.dimension) },
          ]
        : [{
            label: null,
            dims: (allPostDimensions as AnyDimension[]).filter((d) => d !== config.dimension && d !== 'posted_at'),
          }]
  ).filter((g) => g.dims.length > 0);
  const breakdownOptionCount = breakdownGroups.reduce((n, g) => n + g.dims.length, 0);

  // Explicit "Aggregate" step: aggregate Posts (default) or the elements of one
  // list[object] field. Switching seeds a sensible default metric.
  const objectFieldOptions = !isTopics ? (objectFieldDefs ?? []) : [];
  const aggregateValue = activeObjField ?? 'posts';
  const handleAggregateChange = (target: string) => {
    const reset = {
      dimension: undefined,
      breakdownDimension: undefined,
      timeBucket: undefined,
      metricToggle: undefined,
      metricAgg: undefined,
    } as const;
    onChange({
      ...config,
      ...reset,
      metric: target === 'posts'
        ? ('post_count' as AnyMetric)
        : (`${OBJECT_METRIC_PREFIX}${target}.${OBJECT_COUNT_LEAF}` as AnyMetric),
    });
  };

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
      const newObj = isObjectMetric(metric) ? parseObjectMetric(metric as string) : null;
      const dimField = isObjectFieldDimension(next.dimension)
        ? parseObjectDim(next.dimension as string)?.field
        : null;
      if (newObj) {
        // Object metric: count / distinct-posts are implicit (no agg); own
        // numeric defaults to avg, inherited post metric to sum. Reset the agg to
        // the kind default so a stale agg doesn't carry across kinds.
        const def = defaultAggForObjectMetric(newObj.kind);
        if (def) next.metricAgg = def;
        else delete next.metricAgg;
        // Same-field switch keeps the group-by; a different field invalidates it.
        if (dimField && dimField !== newObj.field) {
          delete next.dimension;
          delete next.breakdownDimension;
          delete next.timeBucket;
          delete next.metricToggle;
        }
      } else if (dimField) {
        // Switched back to a post metric while an object dim was set - drop it.
        delete next.dimension;
        delete next.breakdownDimension;
        delete next.timeBucket;
        delete next.metricToggle;
      }
      const validTypes = getValidChartTypesForCustom(next.dimension as CustomDimension | undefined, metric as CustomMetric);
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
    } else if (isObjectFieldDimension(dimension)) {
      // Object leaf dim: no time bucket (elements have no timeline). A breakdown
      // by another leaf is allowed; drop it only if it now collides with the
      // group-by.
      delete next.timeBucket;
      if (next.breakdownDimension === dimension) delete next.breakdownDimension;
    } else {
      if (dimension !== 'posted_at') {
        delete next.timeBucket;
      } else if (!next.timeBucket) {
        next.timeBucket = 'day';
      }
      if (!dimension || dimension === 'posted_at' || next.breakdownDimension === dimension) {
        delete next.breakdownDimension;
      }
    }
    const validTypes = getValidChartTypesForCustom(dimension as CustomDimension | undefined, config.metric as CustomMetric);
    if (!isTopics && !validTypes.includes(config.metric as unknown as SocialChartType)) {
      onChartTypeChange(validTypes[0]);
    }
    onChange(next);
  };

  const aggOptions = isTopics && TOPIC_RATIO_METRICS.has(config.metric as TopicMetric)
    ? RATIO_AGG_OPTIONS
    : objKind === 'own'
      ? RATIO_AGG_OPTIONS
      : objKind === 'inherited'
        ? INHERITED_AGG_OPTIONS
        : AGG_OPTIONS;
  // Aggregation control shows for any grouped widget, plus single-value object
  // agg metrics (avg age / sum views with no group-by). Count + distinct-posts
  // need no agg.
  const showAgg = (!!config.dimension || isObjAggMetric)
    && objKind !== 'count' && objKind !== 'distinctPosts';
  const aggFallback = objKind === 'own'
    ? 'avg'
    : objKind === 'inherited'
      ? 'sum'
      : (isTopics && TOPIC_RATIO_METRICS.has(config.metric as TopicMetric))
        ? 'avg'
        : 'sum';

  return (
    <div className="space-y-3">
      {/* Aggregate - explicit object-field step (only when list[object] fields exist).
          'Posts' = post-level metrics; an object field = aggregate its elements. */}
      {!isTopics && objectFieldOptions.length > 0 && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Aggregate</Label>
          <Select value={aggregateValue} onValueChange={handleAggregateChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="posts">Posts</SelectItem>
              <SelectGroup>
                <SelectLabel>Objects</SelectLabel>
                {objectFieldOptions.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {humanizeField(d.name)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

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
            {objMetricGroups
              ? objMetricGroups.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.metrics.map((metric) => (
                      <SelectItem key={metric as string} value={metric as string}>
                        {labelForMetric(metric)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              : allMetrics.map((metric) => (
                  <SelectItem key={metric as string} value={metric as string}>
                    {labelForMetric(metric)}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>

      {/* Aggregation - visible for grouped widgets + single-value object numerics */}
      {showAgg && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Aggregation</Label>
          <Select
            value={config.metricAgg ?? aggFallback}
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
            {groupByGroups.map((group, gi) => {
              const items = group.dims.map((dim) => {
                const disabled =
                  isTopics &&
                  TOPIC_RATIO_METRICS.has(config.metric as TopicMetric) &&
                  TOPIC_JSON_UNNESTED_DIMENSIONS.has(dim as TopicDimension);
                return (
                  <SelectItem key={dim as string} value={dim as string} disabled={disabled}>
                    {renderDimMeta(dim).label}
                    {disabled ? ' (not supported with ratio metrics)' : ''}
                  </SelectItem>
                );
              });
              return group.label ? (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {items}
                </SelectGroup>
              ) : (
                <SelectGroup key={`g${gi}`}>{items}</SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Breakdown (hue) - posts mode (any post dim) or object mode (a leaf of
          this field OR an inherited post field). Topics defer to phase 2. */}
      {!isTopics && config.dimension && breakdownOptionCount > 0 && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Breakdown</Label>
          <Select
            value={(config.breakdownDimension as string | undefined) ?? 'none'}
            onValueChange={(v) =>
              onChange({ ...config, breakdownDimension: v === 'none' ? undefined : (v as AnyDimension) })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {breakdownGroups.map((group, gi) => {
                const items = group.dims.map((dim) => (
                  <SelectItem key={dim as string} value={dim as string}>
                    {renderDimMeta(dim).label}
                  </SelectItem>
                ));
                return group.label ? (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {items}
                  </SelectGroup>
                ) : (
                  <SelectGroup key={`b${gi}`}>{items}</SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Time bucket - posts-mode only (topic_metrics is a snapshot) */}
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

      {/* Cumulative running total - line charts on a time series */}
      {!isTopics && chartType === 'line' && config.dimension === 'posted_at' && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Cumulative</Label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!config.cumulative}
              onChange={(e) => onChange({ ...config, cumulative: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            Plot a running total instead of per-bucket values
          </label>
        </div>
      )}

      {/* Stacked vs grouped - bar only, when a breakdown is set */}
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
      {config.dimension && !activeObjField && (
        <div className="flex items-start gap-3">
          <Label className="text-xs w-24 shrink-0 pt-1.5">Quick toggle</Label>
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {(isTopics ? ALL_TOPIC_METRICS : ALL_POST_METRICS).map((m) => {
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

      {/* Top N + include Others - categorical primary or time+breakdown */}
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
