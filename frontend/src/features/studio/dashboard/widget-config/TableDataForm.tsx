import { useMemo } from 'react';
import { ArrowDown, ArrowUp, BarChart3, ChevronDown, Grid3x3, Minus, Plus, X } from 'lucide-react';
import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu.tsx';
import { cn } from '../../../../lib/utils.ts';
import type {
  AnyDimension,
  AnyMetric,
  CustomDimension,
  CustomMetric,
  CustomTableConfig,
  DataSource,
  PostField,
  StandardPostField,
  TableColumn,
  TableColumnAgg,
  TableColumnDisplay,
  TableColumnViz,
  TopicDimension,
  TopicMetric,
} from '../types-social-dashboard.ts';
import {
  DIMENSION_META,
  METRIC_META,
  POST_FIELD_META,
  TOPIC_DIMENSION_META,
  TOPIC_METRIC_META,
  OBJECT_METRIC_PREFIX,
  OBJECT_COUNT_LEAF,
  getDimensionMeta,
  getObjectMetricLabel,
  getPostFieldMeta,
  getTopicDimensionMeta,
  CUSTOM_DIM_PREFIX,
  autoColumnHeader,
  isDimensionColumn,
  isPostFieldColumn,
  isObjectMetric,
  objectDimsForDef,
  objectFieldOfTable,
  objectMetricGroupsForDef,
  objectMetricsForDef,
  parseObjectMetric,
  defaultPostTableConfig,
  normalizeTableConfig,
} from '../types-social-dashboard.ts';
import type { CustomFieldDef } from '../../../../api/types.ts';

const STANDARD_DIMENSIONS = Object.keys(DIMENSION_META) as CustomDimension[];
const ALL_METRICS = Object.keys(METRIC_META) as CustomMetric[];
const STANDARD_POST_FIELDS = Object.keys(POST_FIELD_META) as StandardPostField[];
const TOPIC_DIMENSIONS = Object.keys(TOPIC_DIMENSION_META) as TopicDimension[];
const ALL_TOPIC_METRICS = Object.keys(TOPIC_METRIC_META) as TopicMetric[];

const AGG_OPTIONS: Array<{ value: TableColumnAgg; label: string }> = [
  { value: 'sum',   label: 'Total (Sum)' },
  { value: 'avg',   label: 'Average' },
  { value: 'min',   label: 'Minimum' },
  { value: 'max',   label: 'Maximum' },
  { value: 'count', label: 'Count' },
];

// Object own-leaf columns can't be summed meaningfully (avg/min/max); inherited
// post-metric columns can sum/avg/min/max but not count.
const OWN_AGG_OPTIONS = AGG_OPTIONS.filter((o) => o.value !== 'sum' && o.value !== 'count');
const INHERITED_AGG_OPTIONS = AGG_OPTIONS.filter((o) => o.value !== 'count');

const VIZ_OPTIONS: Array<{ value: TableColumnViz; label: string; Icon: typeof Minus }> = [
  { value: 'none',    label: 'Plain number',   Icon: Minus },
  { value: 'bar',     label: 'Inline bar',     Icon: BarChart3 },
  { value: 'heatmap', label: 'Heatmap shade',  Icon: Grid3x3 },
];

const DISPLAY_OPTIONS: Array<{ value: TableColumnDisplay; label: string; title: string }> = [
  { value: 'abs',     label: '#',     title: 'Absolute number' },
  { value: 'pct',     label: '%',     title: '% of column total' },
  { value: 'abs_pct', label: '# (%)', title: 'Number with percent of column total' },
];

interface TableDataFormProps {
  config: CustomTableConfig;
  onChange: (config: CustomTableConfig) => void;
  customFieldNames?: string[];
  /** Declared list[object] field defs - source of typed object-leaf
   *  dimensions/metrics. */
  objectFieldDefs?: CustomFieldDef[];
  /** Which BigQuery source the widget reads. Default 'posts'. When 'topics',
   *  the dimension/metric pickers swap to topic vocabulary and post-mode is
   *  unavailable (topic_metrics rows are 1:1 with topics, no per-post mode). */
  dataSource?: DataSource;
}

function uniqueColumnId(existing: TableColumn[], seed: string): string {
  const taken = new Set(existing.map((c) => c.id));
  if (!taken.has(seed)) return seed;
  let n = 2;
  while (taken.has(`${seed}_${n}`)) n += 1;
  return `${seed}_${n}`;
}

export function TableDataForm({ config: rawConfig, onChange, customFieldNames, objectFieldDefs, dataSource = 'posts' }: TableDataFormProps) {
  const isTopics = dataSource === 'topics';
  // Migrate legacy `dimension` slot into a first dim column so the form only
  // has to think about one model.
  const config = useMemo(() => normalizeTableConfig(rawConfig), [rawConfig]);
  // The legacy field is now redundant - strip it on any mutation so saved
  // widgets converge on the canonical shape.
  const emit = (next: CustomTableConfig) => {
    const { dimension: _drop, ...rest } = next;
    onChange(rest);
  };

  // Element-as-unit object table: the active object field is chosen via the
  // explicit "Rows are" selector and seeded into the columns; once active, the
  // column dim/metric vocabularies are this field's object tokens only (never
  // mixed with post columns, which would fan-out the numbers). Detected from the
  // columns so legacy saved object tables keep working.
  const activeObjField = !isTopics ? objectFieldOfTable(config) : null;
  const activeObjDef = activeObjField
    ? (objectFieldDefs ?? []).find((d) => d.name === activeObjField)
    : undefined;

  const allDimensions = useMemo<AnyDimension[]>(() => {
    if (isTopics) return TOPIC_DIMENSIONS;
    if (activeObjDef) return objectDimsForDef(activeObjDef);
    // list[object] fields aggregate element-as-unit, never as a scalar post
    // dimension - reading one as a scalar yields "[object Object]". Exclude them.
    const objectFieldNames = new Set((objectFieldDefs ?? []).map((d) => d.name));
    const customDims = (customFieldNames ?? [])
      .filter((n) => !objectFieldNames.has(n))
      .map((n) => `${CUSTOM_DIM_PREFIX}${n}` as CustomDimension);
    return [...STANDARD_DIMENSIONS, ...customDims];
  }, [isTopics, activeObjDef, customFieldNames, objectFieldDefs]);
  const allMetrics: AnyMetric[] = isTopics
    ? ALL_TOPIC_METRICS
    : activeObjDef
      ? objectMetricsForDef(activeObjDef)
      : [...ALL_METRICS];
  // Grouped object metrics for the column metric dropdown (Count / fields /
  // Inherited from post). Null when not in an object table.
  const objMetricGroups = activeObjDef ? objectMetricGroupsForDef(activeObjDef) : null;
  // Object fields offered in the "Rows" selector (explicit object-table step).
  const objectFieldOptions = !isTopics ? (objectFieldDefs ?? []) : [];
  const dimMetaFor = (dim: AnyDimension) =>
    isTopics ? getTopicDimensionMeta(dim as TopicDimension) : getDimensionMeta(dim as CustomDimension);
  const metricLabel = (m: AnyMetric): string =>
    isObjectMetric(m)
      ? getObjectMetricLabel(m as string)
      : isTopics
        ? TOPIC_METRIC_META[m as keyof typeof TOPIC_METRIC_META]?.label ?? String(m)
        : METRIC_META[m as CustomMetric]?.label ?? String(m);
  // Sensible defaults when adding a new column. In an active object table, new
  // columns default to that field's object tokens so they stay on one field.
  const defaultDim: AnyDimension = isTopics
    ? 'topic'
    : activeObjDef
      ? objectDimsForDef(activeObjDef)[0] ?? 'sentiment'
      : 'sentiment';
  const defaultMetric: AnyMetric = isTopics
    ? 'post_count'
    : activeObjDef
      ? objectMetricsForDef(activeObjDef)[0]
      : 'like_count';

  const updateColumn = (idx: number, patch: Partial<TableColumn>) => {
    const next = config.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    emit({ ...config, columns: next });
  };

  const removeColumn = (idx: number) => {
    const removed = config.columns[idx];
    const next = config.columns.filter((_, i) => i !== idx);
    // If we removed the sort column, fall back to the first remaining column.
    const sortBy = config.sortBy === removed?.id ? next[0]?.id : config.sortBy;
    emit({ ...config, columns: next, sortBy });
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= config.columns.length) return;
    const next = config.columns.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    emit({ ...config, columns: next });
  };

  const addMetricColumn = () => {
    const id = uniqueColumnId(config.columns, 'col');
    emit({
      ...config,
      columns: [...config.columns, { id, kind: 'metric', metric: defaultMetric, agg: 'sum' }],
    });
  };

  const addDimensionColumn = () => {
    const id = uniqueColumnId(config.columns, 'dim');
    emit({
      ...config,
      columns: [
        ...config.columns,
        { id, kind: 'dimension', dimension: defaultDim },
      ],
    });
  };

  const addPostFieldColumn = () => {
    const id = uniqueColumnId(config.columns, 'field');
    emit({
      ...config,
      columns: [
        ...config.columns,
        { id, kind: 'post-field', postField: 'content' },
      ],
    });
  };

  const isPostMode = config.mode === 'post';

  /** Switch the whole table between group-by and post-level modes. Replaces
   *  columns with the new mode's defaults; preserves cosmetic settings only
   *  - column shapes are incompatible across modes. */
  const setMode = (next: 'group' | 'post') => {
    if (next === (config.mode ?? 'group')) return;
    if (next === 'post') {
      const seeded = defaultPostTableConfig();
      emit({
        ...seeded,
        density: config.density,
        striped: config.striped,
      });
    } else {
      emit({
        mode: 'group',
        columns: [
          { id: '__group_0', kind: 'dimension', dimension: 'channel_handle' },
          { id: 'posts', metric: 'post_count' },
        ],
        sortBy: 'posts',
        sortDir: 'desc',
        rowLimit: 25,
        showRank: true,
        density: config.density,
        striped: config.striped,
      });
    }
  };

  /** Explicit "Rows are" step: post-level, plain group-by, or aggregate the
   *  elements of a specific list[object] field. Picking an object field seeds an
   *  object table (its first categorical leaf as the group, count as the metric). */
  const setRows = (target: string) => {
    if (target === 'post') return setMode('post');
    if (target === 'group') {
      // Already a plain (non-object) group table → nothing to do.
      if (!activeObjField && (config.mode ?? 'group') === 'group') return;
      return setMode('group');
    }
    if (target === activeObjField) return; // already this object field
    const def = (objectFieldDefs ?? []).find((d) => d.name === target);
    const firstLeaf = def ? objectDimsForDef(def)[0] : undefined;
    const columns: TableColumn[] = [];
    if (firstLeaf) columns.push({ id: '__group_0', kind: 'dimension', dimension: firstLeaf });
    columns.push({
      id: 'cnt',
      kind: 'metric',
      metric: `${OBJECT_METRIC_PREFIX}${target}.${OBJECT_COUNT_LEAF}` as AnyMetric,
    });
    emit({
      mode: 'group',
      columns,
      sortBy: 'cnt',
      sortDir: 'desc',
      rowLimit: 25,
      showRank: true,
      density: config.density,
      striped: config.striped,
    });
  };

  /** Switch a column between metric and dimension while preserving its id and
   *  optional header so existing sort/header settings survive the toggle. */
  const setColumnKind = (idx: number, kind: 'metric' | 'dimension') => {
    const cur = config.columns[idx];
    if (!cur) return;
    const next: TableColumn = kind === 'dimension'
      ? { id: cur.id, kind: 'dimension', dimension: cur.dimension ?? defaultDim, header: cur.header }
      : { id: cur.id, kind: 'metric',    metric: cur.metric ?? defaultMetric, agg: cur.agg ?? 'sum', header: cur.header };
    const columns = config.columns.map((c, i) => (i === idx ? next : c));
    emit({ ...config, columns });
  };

  return (
    <div className="space-y-4">
      {/* "Rows are" - what each table row represents: a dimension group, one
          post, or the elements of a list[object] field. Hidden for topic
          widgets (topic_metrics rows are already 1:1 with topics). */}
      {!isTopics && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Rows are</Label>
          <Select
            value={isPostMode ? 'post' : (activeObjField ?? 'group')}
            onValueChange={setRows}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">Dimension groups</SelectItem>
              <SelectItem value="post">Posts</SelectItem>
              {objectFieldOptions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Object elements</SelectLabel>
                  {objectFieldOptions.map((d) => (
                    <SelectItem key={d.name} value={d.name}>
                      {d.name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Columns list - group mode: dimension cols define grouping, metric cols
          aggregate. Post mode: each col reads one raw post field. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Columns
          </Label>
          {isPostMode ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={addPostFieldColumn}
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add column
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={addMetricColumn} className="text-xs">
                  Metric
                  <span className="ml-auto text-[10px] text-muted-foreground">number</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addDimensionColumn} className="text-xs">
                  Dimension
                  <span className="ml-auto text-[10px] text-muted-foreground">label</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {config.columns.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            No columns - add at least one to render the table.
          </p>
        ) : (
          <div className="space-y-1.5">
            {config.columns.map((col, idx) => {
              const isDim = isDimensionColumn(col);
              const isPost = isPostFieldColumn(col);
              const kind: 'metric' | 'dimension' = isDim ? 'dimension' : 'metric';
              const objKindCol = !isDim && !isPost && isObjectMetric(col.metric)
                ? parseObjectMetric(col.metric as string)?.kind ?? null
                : null;
              // count / distinct-posts have no aggregation; own numeric defaults
              // to avg (summing ages is meaningless), inherited post metric to sum.
              const isCountForced = (!isDim && !isPost && col.metric === 'post_count')
                || objKindCol === 'count' || objKindCol === 'distinctPosts';
              const objDefaultAgg: TableColumnAgg | undefined =
                objKindCol === 'inherited' ? 'sum' : objKindCol === 'own' ? 'avg' : undefined;
              const effectiveAgg: TableColumnAgg = isCountForced
                ? 'count'
                : (col.agg ?? objDefaultAgg ?? 'sum');
              const colAggOptions = objKindCol === 'own'
                ? OWN_AGG_OPTIONS
                : objKindCol === 'inherited'
                  ? INHERITED_AGG_OPTIONS
                  : AGG_OPTIONS;
              // Post-field numeric flag - drives viz/display toggle visibility in post mode.
              const postRender = isPost ? getPostFieldMeta(col.postField).render : null;
              // Viz/format toggles only make sense for numeric cells.
              const isNumericCol = (!isDim && !isPost) || postRender === 'numeric';
              const effectiveViz: TableColumnViz = col.viz ?? 'none';
              const effectiveDisplay: TableColumnDisplay = col.display ?? 'abs';
              return (
                <div
                  key={col.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 p-1.5"
                >
                  {/* Reorder */}
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveColumn(idx, -1)}
                      disabled={idx === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(idx, 1)}
                      disabled={idx === config.columns.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Kind toggle - group mode only; post mode columns are all
                       post-field, no inter-kind switching. */}
                  {isPost ? (
                    <span className="text-[11px] font-medium text-muted-foreground w-[100px] px-1 truncate">
                      Post field
                    </span>
                  ) : (
                    <Select
                      value={kind}
                      onValueChange={(v) => setColumnKind(idx, v as 'metric' | 'dimension')}
                    >
                      <SelectTrigger className="h-7 text-xs w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="metric">Metric</SelectItem>
                        <SelectItem value="dimension">Dimension</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {/* Field selector - post-field, dimension, or metric */}
                  {isPost ? (
                    <Select
                      value={col.postField ?? 'content'}
                      onValueChange={(v) => updateColumn(idx, { postField: v as PostField })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STANDARD_POST_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {POST_FIELD_META[f].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isDim ? (
                    <Select
                      value={(col.dimension as string | undefined) ?? (defaultDim as string)}
                      onValueChange={(v) => updateColumn(idx, { dimension: v as AnyDimension })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allDimensions.map((dim) => (
                          <SelectItem key={dim as string} value={dim as string}>
                            {dimMetaFor(dim).label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={(col.metric as string | undefined) ?? (defaultMetric as string)}
                      onValueChange={(v) => updateColumn(idx, { metric: v as AnyMetric })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {objMetricGroups
                          ? objMetricGroups.map((g) => (
                              <SelectGroup key={g.label}>
                                <SelectLabel>{g.label}</SelectLabel>
                                {g.metrics.map((m) => (
                                  <SelectItem key={m as string} value={m as string}>
                                    {metricLabel(m)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))
                          : allMetrics.map((m) => (
                              <SelectItem key={m as string} value={m as string}>
                                {metricLabel(m)}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Aggregation - group-mode metric columns only. Dimensions
                       contribute to the compound key; post-field columns read
                       raw values with no agg. Topic widgets have 1:1 rows
                       (no grouping) - metric columns also read raw values. */}
                  {isPost ? (
                    <span className="text-[11px] text-muted-foreground w-[120px] px-1 truncate">
                      Raw value
                    </span>
                  ) : isDim ? (
                    <span className="text-[11px] text-muted-foreground w-[120px] px-1 truncate">
                      {isTopics ? 'Topic field' : 'Group by'}
                    </span>
                  ) : isTopics ? (
                    <span className="text-[11px] text-muted-foreground w-[120px] px-1 truncate">
                      Raw value
                    </span>
                  ) : (
                    <Select
                      value={effectiveAgg}
                      onValueChange={(v) => updateColumn(idx, { agg: v as TableColumnAgg })}
                      disabled={isCountForced}
                    >
                      <SelectTrigger className={cn('h-7 text-xs w-[120px]', isCountForced && 'opacity-60')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {colAggOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Header override */}
                  <Input
                    value={col.header ?? ''}
                    onChange={(e) =>
                      updateColumn(idx, { header: e.target.value || undefined })
                    }
                    placeholder={autoColumnHeader(col)}
                    className="h-7 text-xs flex-1 min-w-0"
                  />

                  {/* In-cell viz toggle - numeric columns only */}
                  {isNumericCol && (
                    <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
                      {VIZ_OPTIONS.map(({ value, label, Icon }) => {
                        const active = effectiveViz === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              updateColumn(idx, { viz: value === 'none' ? undefined : value })
                            }
                            title={label}
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded transition-colors',
                              active
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <Icon className="h-3 w-3" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Numeric display format toggle - numeric columns only */}
                  {isNumericCol && (
                    <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
                      {DISPLAY_OPTIONS.map(({ value, label, title }) => {
                        const active = effectiveDisplay === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              updateColumn(idx, { display: value === 'abs' ? undefined : value })
                            }
                            title={title}
                            className={cn(
                              'flex h-6 items-center justify-center rounded px-1.5 text-[10px] font-medium tabular-nums transition-colors',
                              active
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeColumn(idx)}
                    className="text-muted-foreground hover:text-destructive p-0.5"
                    title="Remove column"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Sort by</Label>
        <Select
          value={config.sortBy ?? config.columns[0]?.id ?? ''}
          onValueChange={(v) => emit({ ...config, sortBy: v })}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {config.columns.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.header || autoColumnHeader(col)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          {(['desc', 'asc'] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => emit({ ...config, sortDir: dir })}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-all capitalize',
                (config.sortDir ?? 'desc') === dir
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              {dir}
            </button>
          ))}
        </div>
      </div>

      {/* Row limit */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Row limit</Label>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={config.rowLimit ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              emit({ ...config, rowLimit: undefined });
              return;
            }
            const n = Math.max(1, Math.min(500, Math.floor(Number(raw))));
            if (!Number.isFinite(n)) return;
            emit({ ...config, rowLimit: n });
          }}
          placeholder="25"
          className="h-8 w-24 text-xs"
        />
        <span className="text-[11px] text-muted-foreground">rows</span>
      </div>

      {/* Break down by - secondary dimension drill-down (expandable sub-rows).
          Group mode only; not for topic or element-as-unit object tables. */}
      {!isTopics && !activeObjDef && !isPostMode && (
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Break down by</Label>
          <Select
            value={config.breakdownDimension ?? '__none__'}
            onValueChange={(v) =>
              emit({ ...config, breakdownDimension: v === '__none__' ? undefined : (v as CustomDimension) })
            }
          >
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {STANDARD_DIMENSIONS.map((dim) => (
                <SelectItem key={dim as string} value={dim as string}>
                  {getDimensionMeta(dim).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Show rank */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={config.showRank ?? true}
          onChange={(e) => emit({ ...config, showRank: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer"
        />
        Show rank # column
      </label>
    </div>
  );
}
