import { useMemo } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from 'lucide-react';
import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
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
  CustomDimension,
  CustomMetric,
  CustomTableConfig,
  TableColumn,
  TableColumnAgg,
  TableDimensionAgg,
} from '../types-social-dashboard.ts';
import {
  DIMENSION_META,
  METRIC_META,
  getDimensionMeta,
  CUSTOM_DIM_PREFIX,
  autoColumnHeader,
  isDimensionColumn,
} from '../types-social-dashboard.ts';

const STANDARD_DIMENSIONS = Object.keys(DIMENSION_META) as CustomDimension[];
const ALL_METRICS = Object.keys(METRIC_META) as CustomMetric[];

const AGG_OPTIONS: Array<{ value: TableColumnAgg; label: string }> = [
  { value: 'sum',   label: 'Total (Sum)' },
  { value: 'avg',   label: 'Average' },
  { value: 'min',   label: 'Minimum' },
  { value: 'max',   label: 'Maximum' },
  { value: 'count', label: 'Count' },
];

const DIM_AGG_OPTIONS: Array<{ value: TableDimensionAgg; label: string }> = [
  { value: 'top',            label: 'Most common' },
  { value: 'distinct_count', label: 'Distinct count' },
];

interface TableDataFormProps {
  config: CustomTableConfig;
  onChange: (config: CustomTableConfig) => void;
  customFieldNames?: string[];
}

function uniqueColumnId(existing: TableColumn[], seed: string): string {
  const taken = new Set(existing.map((c) => c.id));
  if (!taken.has(seed)) return seed;
  let n = 2;
  while (taken.has(`${seed}_${n}`)) n += 1;
  return `${seed}_${n}`;
}

export function TableDataForm({ config, onChange, customFieldNames }: TableDataFormProps) {
  const allDimensions = useMemo<CustomDimension[]>(() => {
    const customDims = (customFieldNames ?? []).map(
      (n) => `${CUSTOM_DIM_PREFIX}${n}` as CustomDimension,
    );
    return [...STANDARD_DIMENSIONS, ...customDims];
  }, [customFieldNames]);

  const updateColumn = (idx: number, patch: Partial<TableColumn>) => {
    const next = config.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...config, columns: next });
  };

  const removeColumn = (idx: number) => {
    const removed = config.columns[idx];
    const next = config.columns.filter((_, i) => i !== idx);
    // If we removed the sort column, fall back to the first remaining column.
    const sortBy = config.sortBy === removed?.id ? next[0]?.id : config.sortBy;
    onChange({ ...config, columns: next, sortBy });
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= config.columns.length) return;
    const next = config.columns.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...config, columns: next });
  };

  const addMetricColumn = () => {
    const id = uniqueColumnId(config.columns, 'col');
    onChange({
      ...config,
      columns: [...config.columns, { id, kind: 'metric', metric: 'like_count', agg: 'sum' }],
    });
  };

  const addDimensionColumn = () => {
    const id = uniqueColumnId(config.columns, 'dim');
    onChange({
      ...config,
      columns: [
        ...config.columns,
        { id, kind: 'dimension', dimension: 'sentiment', dimensionAgg: 'top' },
      ],
    });
  };

  /** Switch a column between metric and dimension while preserving its id and
   *  optional header so existing sort/header settings survive the toggle. */
  const setColumnKind = (idx: number, kind: 'metric' | 'dimension') => {
    const cur = config.columns[idx];
    if (!cur) return;
    const next: TableColumn = kind === 'dimension'
      ? { id: cur.id, kind: 'dimension', dimension: cur.dimension ?? 'sentiment', dimensionAgg: cur.dimensionAgg ?? 'top', header: cur.header }
      : { id: cur.id, kind: 'metric',    metric: cur.metric ?? 'like_count',     agg: cur.agg ?? 'sum',                   header: cur.header };
    const columns = config.columns.map((c, i) => (i === idx ? next : c));
    onChange({ ...config, columns });
  };

  return (
    <div className="space-y-4">
      {/* Group By — single dimension that defines each row */}
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Group By</Label>
        <Select
          value={config.dimension}
          onValueChange={(v) => onChange({ ...config, dimension: v as CustomDimension })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allDimensions.map((dim) => (
              <SelectItem key={dim} value={dim}>
                {getDimensionMeta(dim).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Columns list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Columns
          </Label>
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
        </div>

        {config.columns.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            No columns — add at least one to render the table.
          </p>
        ) : (
          <div className="space-y-1.5">
            {config.columns.map((col, idx) => {
              const isDim = isDimensionColumn(col);
              const kind: 'metric' | 'dimension' = isDim ? 'dimension' : 'metric';
              const isPostCount = !isDim && col.metric === 'post_count';
              const effectiveAgg: TableColumnAgg = isPostCount ? 'count' : (col.agg ?? 'sum');
              const effectiveDimAgg: TableDimensionAgg = col.dimensionAgg ?? 'top';
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

                  {/* Kind toggle */}
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

                  {/* Field selector — metric or dimension based on kind */}
                  {isDim ? (
                    <Select
                      value={col.dimension ?? 'sentiment'}
                      onValueChange={(v) => updateColumn(idx, { dimension: v as CustomDimension })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allDimensions.map((dim) => (
                          <SelectItem key={dim} value={dim}>
                            {getDimensionMeta(dim).label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={col.metric ?? 'like_count'}
                      onValueChange={(v) => updateColumn(idx, { metric: v as CustomMetric })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_METRICS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {METRIC_META[m].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Aggregation — metric agg or dimension agg */}
                  {isDim ? (
                    <Select
                      value={effectiveDimAgg}
                      onValueChange={(v) => updateColumn(idx, { dimensionAgg: v as TableDimensionAgg })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIM_AGG_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={effectiveAgg}
                      onValueChange={(v) => updateColumn(idx, { agg: v as TableColumnAgg })}
                      disabled={isPostCount}
                    >
                      <SelectTrigger className={cn('h-7 text-xs w-[120px]', isPostCount && 'opacity-60')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGG_OPTIONS.map((opt) => (
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
          value={config.sortBy ?? config.columns[0]?.id ?? '__dim'}
          onValueChange={(v) => onChange({ ...config, sortBy: v })}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__dim">{getDimensionMeta(config.dimension).label} (label)</SelectItem>
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
              onClick={() => onChange({ ...config, sortDir: dir })}
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
              onChange({ ...config, rowLimit: undefined });
              return;
            }
            const n = Math.max(1, Math.min(500, Math.floor(Number(raw))));
            if (!Number.isFinite(n)) return;
            onChange({ ...config, rowLimit: n });
          }}
          placeholder="25"
          className="h-8 w-24 text-xs"
        />
        <span className="text-[11px] text-muted-foreground">rows</span>
      </div>

      {/* Show rank */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={config.showRank ?? true}
          onChange={(e) => onChange({ ...config, showRank: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer"
        />
        Show rank # column
      </label>
    </div>
  );
}
