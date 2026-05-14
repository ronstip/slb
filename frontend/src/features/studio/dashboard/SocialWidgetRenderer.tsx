import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { SocialDashboardWidget, WidgetData, FilterCondition, FilterConditionField, CustomMetric, CustomTableConfig, CustomDimension } from './types-social-dashboard.ts';
import { NUMERIC_CONDITION_FIELDS, DATE_CONDITION_FIELDS, METRIC_META, normalizeWidgetAggregation, defaultTableConfigFor, autoColumnHeader, getDimensionMeta, isDimensionColumn } from './types-social-dashboard.ts';
import { aggregateCustom, aggregateTable, type TableRow } from './dashboard-aggregations.ts';
import {
  aggregateSentiment,
  aggregateEmotions,
  aggregatePlatforms,
  aggregateThemeCloud,
  aggregateThemes,
  aggregateEntities,
  aggregateChannels,
  aggregateContentTypes,
  aggregateLanguages,
  aggregateEngagementRate,
  computeEnhancedKpis,
} from './dashboard-aggregations.ts';
import type { ColumnDef } from '../../../components/DataTable/DataTable.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { SocialChartWidget } from './SocialChartWidget.tsx';
import { SocialKpiCard } from './SocialKpiCard.tsx';
import { SocialProgressListWidget } from './SocialProgressListWidget.tsx';
import { SocialWordCloudWidget } from './SocialWordCloudWidget.tsx';
import { SocialWidgetFrame } from './SocialWidgetFrame.tsx';
import { DataTable } from '../../../components/DataTable/DataTable.tsx';
import { postColumns } from '../../../components/DataTable/columns.tsx';
import { ExpandedPostRow } from '../../../components/DataTable/ExpandedPostRow.tsx';
import { Markdown } from '../../../components/Markdown.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import { Copy, MoreVertical, Settings2, Trash2 } from 'lucide-react';

// ── Configurable table widget ─────────────────────────────────────────────────

/** Map a dimension to the dashboard filter key — used to wire row-click
 *  filtering. Returns undefined for dimensions that don't correspond to a
 *  single-value filter (e.g. posted_at, or custom enrichment fields). */
function filterKeyForDimension(dim: CustomDimension): string | undefined {
  switch (dim) {
    case 'channel_handle': return 'channels';
    case 'entities':       return 'entities';
    case 'themes':         return 'themes';
    case 'platform':       return 'platform';
    case 'sentiment':      return 'sentiment';
    case 'emotion':        return 'emotion';
    case 'language':       return 'language';
    case 'content_type':   return 'content_type';
    default:               return undefined;
  }
}

function buildTableColumns(
  tableConfig: CustomTableConfig,
): ColumnDef<TableRow>[] {
  const cols: ColumnDef<TableRow>[] = [];

  if (tableConfig.showRank !== false) {
    cols.push({
      key: '__rank',
      header: '#',
      width: 'w-10',
      sortable: false,
      render: (_row, idx) => (
        <span className="text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</span>
      ),
    });
  }

  const isChannel = tableConfig.dimension === 'channel_handle';
  cols.push({
    key: '__dim',
    header: getDimensionMeta(tableConfig.dimension).label,
    // Dimension is a string; DataTable's sort is numeric-only (apart from a
    // hardcoded posted_at branch), so we don't expose a header-click sort
    // here. Sort by label is still achievable via the config dialog (Sort by
    // → "Label"), and `aggregateTable` pre-sorts the rows before render.
    sortable: false,
    render: (row) =>
      isChannel ? (
        <div className="flex items-center gap-2 min-w-0">
          {row.__platform && <PlatformIcon platform={row.__platform} className="h-3.5 w-3.5 shrink-0" />}
          <span className="text-[12px] font-medium text-foreground truncate">@{row.__label}</span>
        </div>
      ) : (
        <span className="text-[12px] font-medium text-foreground truncate">{row.__label}</span>
      ),
  });

  for (const col of tableConfig.columns) {
    if (isDimensionColumn(col)) {
      const dimAgg = col.dimensionAgg ?? 'top';
      const isCount = dimAgg === 'distinct_count';
      cols.push({
        key: col.id,
        header: col.header || autoColumnHeader(col),
        align: isCount ? 'right' : 'left',
        // String values (top): DataTable's header sort is numeric-only and
        // would scramble — fall back to aggregateTable's pre-sort by setting
        // sortBy via the config dialog. distinct_count is numeric → sortable.
        sortable: isCount,
        render: (row) => {
          const v = row[col.id];
          if (isCount) {
            return <span className="tabular-nums">{formatNumber(Number(v ?? 0))}</span>;
          }
          const text = v == null || v === '' ? '—' : String(v);
          return <span className="text-[12px] text-foreground truncate">{text}</span>;
        },
      });
    } else {
      cols.push({
        key: col.id,
        header: col.header || autoColumnHeader(col),
        align: 'right',
        sortable: true,
        render: (row) => (
          <span className="tabular-nums">
            {formatNumber(Number(row[col.id] ?? 0))}
          </span>
        ),
      });
    }
  }

  return cols;
}

function ConfigurableTableWidget({
  posts,
  tableConfig,
  onFilterToggle,
}: {
  posts: DashboardPost[];
  tableConfig: CustomTableConfig;
  onFilterToggle?: (key: string, value: string) => void;
}) {
  const rows = useMemo(() => aggregateTable(posts, tableConfig), [posts, tableConfig]);
  const columns = useMemo(() => buildTableColumns(tableConfig), [tableConfig]);
  const filterKey = filterKeyForDimension(tableConfig.dimension);
  // When the active sort key produces strings (the dimension label, or a
  // dimension column with 'top' agg), rely on aggregateTable's pre-sort —
  // DataTable's sort is numeric-only and would scramble the order.
  const sortBy = tableConfig.sortBy ?? tableConfig.columns[0]?.id;
  const sortCol = tableConfig.columns.find((c) => c.id === sortBy);
  const sortIsString =
    sortBy === '__dim' ||
    (sortCol != null && isDimensionColumn(sortCol) && (sortCol.dimensionAgg ?? 'top') === 'top');
  const defaultSortKey = sortIsString ? undefined : sortBy;

  return (
    <DataTable<TableRow>
      data={rows}
      columns={columns}
      getRowKey={(r) => r.__key}
      defaultSortKey={defaultSortKey}
      defaultSortDir={tableConfig.sortDir ?? 'desc'}
      pageSize={tableConfig.rowLimit ?? 25}
      // Defaults chosen to match the original Top Channels look:
      // generous row padding, no stripes — the user can tweak both in the
      // Style tab.
      density={tableConfig.density ?? 'comfortable'}
      striped={tableConfig.striped ?? false}
      emptyMessage="No data"
      onRowClick={
        filterKey && onFilterToggle
          ? (r) => onFilterToggle(filterKey, r.__key)
          : undefined
      }
    />
  );
}

// ── Generic table for custom widgets ──────────────────────────────────────────

function GenericTableView({ data }: { data: WidgetData | undefined }) {
  if (!data?.labels || !data.values || data.labels.length === 0) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No data</div>;
  }
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Label</th>
            <th className="px-2 py-1.5 font-medium text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.labels.map((label, i) => (
            <tr key={label} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-2 py-1.5 truncate max-w-[200px]">{label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{data.values![i].toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Filter helper ─────────────────────────────────────────────────────────────

export function applyWidgetFilters(
  posts: DashboardPost[],
  filters: SocialDashboardWidget['filters'],
): DashboardPost[] {
  if (!filters) return posts;
  return posts.filter((p) => {
    if (filters.sentiment?.length && !filters.sentiment.includes(p.sentiment || '')) return false;
    if (filters.emotion?.length && !filters.emotion.includes(p.emotion || '')) return false;
    if (filters.platform?.length && !filters.platform.includes(p.platform)) return false;
    if (filters.language?.length && !filters.language.includes(p.language || '')) return false;
    if (filters.content_type?.length && !filters.content_type.includes(p.content_type || '')) return false;
    if (filters.collection?.length && !filters.collection.includes(p.collection_id)) return false;
    if (filters.channels?.length && !filters.channels.includes(p.channel_handle || '')) return false;
    if (filters.themes?.length && !filters.themes.some((t) => (p.themes ?? []).includes(t))) return false;
    if (filters.entities?.length && !filters.entities.some((e) => (p.entities ?? []).includes(e))) return false;
    if (filters.date_range?.from || filters.date_range?.to) {
      const d = p.posted_at?.slice(0, 10) ?? '';
      if (filters.date_range?.from && d < filters.date_range.from) return false;
      if (filters.date_range?.to && d > filters.date_range.to) return false;
    }
    // Advanced conditions
    if (filters.conditions?.length) {
      for (const cond of filters.conditions) {
        if (!matchesCondition(p, cond)) return false;
      }
    }
    return true;
  });
}

function getConditionFieldValue(post: DashboardPost, field: FilterConditionField): string | number {
  switch (field) {
    case 'like_count': return post.like_count ?? 0;
    case 'view_count': return post.view_count ?? 0;
    case 'comment_count': return post.comment_count ?? 0;
    case 'share_count': return post.share_count ?? 0;
    case 'engagement_total': return (post.like_count ?? 0) + (post.comment_count ?? 0) + (post.share_count ?? 0);
    case 'posted_at': return post.posted_at?.slice(0, 10) ?? '';
    case 'text': return post.content ?? '';
  }
}

function matchesCondition(post: DashboardPost, cond: FilterCondition): boolean {
  const val = getConditionFieldValue(post, cond.field);
  if (NUMERIC_CONDITION_FIELDS.includes(cond.field)) {
    const n = val as number;
    const cv = Number(cond.value);
    switch (cond.operator) {
      case 'greaterThan': return n > cv;
      case 'lessThan': return n < cv;
      case 'equals': return n === cv;
      case 'between': return n >= cv && n <= Number(cond.value2 ?? cv);
      default: return true;
    }
  }
  if (DATE_CONDITION_FIELDS.includes(cond.field)) {
    const d = val as string;
    switch (cond.operator) {
      case 'before': return d < String(cond.value);
      case 'after': return d > String(cond.value);
      case 'between': return d >= String(cond.value) && d <= String(cond.value2 ?? cond.value);
      default: return true;
    }
  }
  // text fields
  const t = (val as string).toLowerCase();
  switch (cond.operator) {
    case 'contains': return t.includes(String(cond.value).toLowerCase());
    case 'notContains': return !t.includes(String(cond.value).toLowerCase());
    case 'isEmpty': return t.length === 0;
    case 'isNotEmpty': return t.length > 0;
    default: return true;
  }
}

// ── Shared frame props ────────────────────────────────────────────────────────

interface FrameProps {
  widget: SocialDashboardWidget;
  isEditMode: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  /** Optional callback: when a text widget's rendered content height changes,
   * the grid receives a suggested new grid-row height. Used to auto-fit text
   * widgets to their content (no inner scroll). */
  onAutoSize?: (i: string, h: number) => void;
}

// ── Sub-components (each calls hooks unconditionally) ─────────────────────────

function KpiWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, serverKpis }: FrameProps & { posts: DashboardPost[]; serverKpis?: DashboardKpis }) {
  const kpis = useMemo(() => computeEnhancedKpis(posts, serverKpis), [posts, serverKpis]);
  const kpi = kpis[widget.kpiIndex ?? 0];
  return (
    <SocialKpiCard
      kpi={kpi}
      accent={widget.styleOverrides?.accent ?? widget.accent}
      kpiIndex={widget.kpiIndex ?? 0}
      size={widget.numberSize}
      isEditMode={isEditMode}
      onConfigure={onConfigure}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    />
  );
}

function WordCloudWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const cloudData = useMemo(() => aggregateThemeCloud(posts), [posts]);
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialWordCloudWidget
        data={cloudData}
        onWordClick={onFilterToggle ? (v) => onFilterToggle('themes', v) : undefined}
      />
    </SocialWidgetFrame>
  );
}

function EntityWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const entityData = useMemo(() => aggregateEntities(posts), [posts]);
  const listData = useMemo<WidgetData>(() => ({
    labels: entityData.map((d) => d.entity),
    values: entityData.map((d) => d.mentions),
  }), [entityData]);

  if (widget.chartType === 'table') {
    // tableConfig drives the configurable design; falls back to the hardcoded
    // EntityTable only when neither the widget nor the dimension has defaults.
    const tableConfig = widget.tableConfig ?? defaultTableConfigFor('entities');
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <ConfigurableTableWidget
          posts={posts}
          tableConfig={tableConfig}
          onFilterToggle={onFilterToggle}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialProgressListWidget data={listData} />
    </SocialWidgetFrame>
  );
}

function ChannelWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const channelData = useMemo(() => aggregateChannels(posts), [posts]);
  const listData = useMemo<WidgetData>(() => ({
    labels: channelData.map((d) => d.channel_handle),
    values: channelData.map((d) => d.collected_posts),
  }), [channelData]);

  if (widget.chartType === 'table') {
    const tableConfig = widget.tableConfig ?? defaultTableConfigFor('channel_handle');
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <ConfigurableTableWidget
          posts={posts}
          tableConfig={tableConfig}
          onFilterToggle={onFilterToggle}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialProgressListWidget data={listData} />
    </SocialWidgetFrame>
  );
}

function CustomWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const config = widget.customConfig;

  // Optional viewer-facing metric toggle. The persisted `metric` is the
  // initial selection; the toggle list normally contains it.
  const toggleMetrics = (config?.metricToggle?.length ?? 0) >= 2 ? config!.metricToggle! : undefined;
  const [activeMetric, setActiveMetric] = useState<CustomMetric>(() => config?.metric ?? 'post_count');
  // Reset when the underlying widget config changes (e.g. user opens a
  // different widget that reuses this dispatch path).
  useEffect(() => {
    if (!config) return;
    setActiveMetric(config.metric);
  }, [config?.metric, toggleMetrics?.join(',')]);

  const effectiveConfig = useMemo(
    () => (config ? { ...config, metric: activeMetric } : null),
    [config, activeMetric],
  );

  const data = useMemo<WidgetData | null>(() => {
    if (!effectiveConfig) return null;
    return aggregateCustom(posts, effectiveConfig);
  }, [posts, effectiveConfig]);

  const cloudData = useMemo(() => {
    if (!data?.labels || !data.values) return [];
    return data.labels.map((text, i) => ({ text, value: data.values![i] }));
  }, [data]);

  const syntheticKpi = useMemo(
    () => ({ label: widget.title, value: data?.value ?? 0, icon: 'posts' as const, sparklineData: [] }),
    [widget.title, data?.value],
  );

  const headerAction = toggleMetrics ? (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
      {toggleMetrics.map((m, i) => (
        <button
          key={m}
          type="button"
          onClick={() => setActiveMetric(m)}
          className={`px-2 py-0.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
            activeMetric === m
              ? 'bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          {METRIC_META[m].label}
        </button>
      ))}
    </div>
  ) : undefined;

  if (!config) {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          Configure this widget to select a metric
        </div>
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'number-card') {
    return (
      <SocialKpiCard
        kpi={syntheticKpi}
        accent={widget.styleOverrides?.accent ?? widget.accent}
        size={widget.numberSize}
        isEditMode={isEditMode}
        onConfigure={onConfigure}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
      />
    );
  }

  if (widget.chartType === 'word-cloud') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
        <SocialWordCloudWidget data={cloudData} />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'progress-list') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
        <SocialProgressListWidget
          data={data ?? undefined}
          accent={widget.styleOverrides?.accent ?? widget.accent}
          seriesColorOverrides={widget.styleOverrides?.seriesColors}
        />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'table') {
    // Prefer the configurable table (multi-column, sortable, picks columns).
    // If the widget has no tableConfig but its dimension matches a known
    // preset (channel_handle / entities), synthesize defaults so legacy
    // widgets keep rendering the rich design without losing functionality.
    const tableConfig = widget.tableConfig
      ?? (config.dimension ? defaultTableConfigFor(config.dimension) : undefined);
    if (tableConfig) {
      return (
        <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
          <ConfigurableTableWidget
            posts={posts}
            tableConfig={tableConfig}
            onFilterToggle={onFilterToggle}
          />
        </SocialWidgetFrame>
      );
    }
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
        <GenericTableView data={data ?? undefined} />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
      <SocialChartWidget
        chartType={widget.chartType}
        data={data ?? undefined}
        accent={widget.styleOverrides?.accent ?? widget.accent}
        seriesColorOverrides={widget.styleOverrides?.seriesColors}
        barOrientation={widget.customConfig?.barOrientation}
        stacked={widget.customConfig?.stacked ?? true}
      />
    </SocialWidgetFrame>
  );
}

function GenericChartWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  const chartData = useMemo<WidgetData | null>(() => {
    switch (widget.aggregation) {
      case 'sentiment': {
        const d = aggregateSentiment(posts);
        return { labels: d.map((x) => x.sentiment), values: d.map((x) => x.count) };
      }
      case 'emotion': {
        const d = aggregateEmotions(posts);
        return { labels: d.map((x) => x.emotion), values: d.map((x) => x.count) };
      }
      case 'platform': {
        const d = aggregatePlatforms(posts);
        return { labels: d.map((x) => x.platform), values: d.map((x) => x.post_count) };
      }
      case 'themes': {
        const d = aggregateThemes(posts);
        return { labels: d.map((x) => x.theme), values: d.map((x) => x.post_count) };
      }
      case 'content-type': {
        const d = aggregateContentTypes(posts);
        return { labels: d.map((x) => x.content_type), values: d.map((x) => x.count) };
      }
      case 'language': {
        const d = aggregateLanguages(posts);
        return { labels: d.map((x) => x.language), values: d.map((x) => x.post_count) };
      }
      case 'engagement-rate': {
        const d = aggregateEngagementRate(posts);
        return { timeSeries: d.map((x) => ({ date: x.date, value: x.rate })) };
      }
      case 'theme-cloud': {
        const d = aggregateThemeCloud(posts);
        return { labels: d.map((x) => x.text), values: d.map((x) => x.value) };
      }
      default:
        return null;
    }
  }, [widget.aggregation, posts]);

  if (widget.chartType === 'progress-list') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <SocialProgressListWidget data={chartData ?? undefined} />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialChartWidget
        chartType={widget.chartType}
        data={chartData ?? undefined}
        accent={widget.styleOverrides?.accent ?? widget.accent}
        seriesColorOverrides={widget.styleOverrides?.seriesColors}
        barOrientation={widget.customConfig?.barOrientation}
      />
    </SocialWidgetFrame>
  );
}

// ── Text (markdown) widget ────────────────────────────────────────────────────

function TextWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize }: FrameProps) {
  const content = widget.markdownContent ?? '';
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Auto-fit the widget grid height to its rendered content. Avoids inner
  // scrollbars and large pockets of empty whitespace. Fires on mount, on
  // content change, and on container resize. Updates are debounced to a
  // single rAF to coalesce burst observer callbacks during layout flush.
  useEffect(() => {
    if (!onAutoSize || !contentRef.current) return;
    const ROW_HEIGHT_PX = 48;
    const MARGIN_Y_PX = 6;
    const BOTTOM_PAD_PX = 24; // visual breathing room below last block
    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!contentRef.current) return;
        const contentH = contentRef.current.scrollHeight;
        const cellPx = contentH + BOTTOM_PAD_PX;
        const targetH = Math.max(2, Math.ceil(cellPx / (ROW_HEIGHT_PX + MARGIN_Y_PX)));
        if (Math.abs(targetH - widget.h) >= 1) {
          onAutoSize(widget.i, targetH);
        }
      });
    };
    const observer = new ResizeObserver(recompute);
    observer.observe(contentRef.current);
    recompute();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [widget.i, widget.h, content, onAutoSize]);

  // No card chrome: transparent background, no border, no header. In edit mode
  // the entire widget acts as the drag handle and a floating menu surfaces the
  // configure/remove/duplicate actions on hover.
  return (
    <div
      className={`h-full relative group bg-transparent ${
        isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing ring-1 ring-dashed ring-primary/30 rounded-md' : ''
      }`}
    >
      {isEditMode && (
        <div
          className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-background/80 backdrop-blur-sm shadow-sm">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onConfigure}>
                <Settings2 className="h-3.5 w-3.5 mr-2" />
                Configure
              </DropdownMenuItem>
              {onDuplicate && (
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {content.trim() ? (
        <div className="h-full overflow-y-auto">
          {/* Inner div is the natural-height content; outer wrapper provides
              the scrolling fallback if auto-size hasn't caught up yet. The
              `ref` is placed on the inner div so scrollHeight measures the
              content, not the (possibly oversized) cell. */}
          <div ref={contentRef}>
            <Markdown
              autoDir
              stripComments={false}
              headingIds
              className="agent-prose max-w-none break-words text-sm leading-relaxed"
            >
              {content}
            </Markdown>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
          Empty text card — click the gear to add markdown
        </div>
      )}
    </div>
  );
}

// ── Posts table widget ────────────────────────────────────────────────────────

interface PostTableRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title?: string | null;
  content?: string | null;
  post_url: string;
  posted_at: string;
  likes: number;
  views: number;
  comments_count: number;
  shares: number;
  sentiment?: string | null;
  themes?: string[];
  entities?: string[];
  emotion?: string | null;
  content_type?: string | null;
  custom_fields?: Record<string, unknown> | null;
  ai_summary?: string | null;
  context?: string | null;
  detected_brands?: string[];
  channel_type?: string | null;
  media_refs?: string;
}

function toPostTableRows(posts: DashboardPost[]): PostTableRow[] {
  return posts.map((p) => ({
    post_id: p.post_id,
    platform: p.platform,
    channel_handle: p.channel_handle,
    title: p.title,
    content: p.content,
    post_url: p.post_url ?? '',
    posted_at: p.posted_at,
    likes: p.like_count,
    views: p.view_count,
    comments_count: p.comment_count,
    shares: p.share_count,
    sentiment: p.sentiment,
    themes: p.themes,
    entities: p.entities,
    emotion: p.emotion,
    content_type: p.content_type,
    custom_fields: p.custom_fields,
    ai_summary: p.ai_summary,
    context: p.context,
    detected_brands: p.detected_brands,
    channel_type: p.channel_type,
    media_refs: p.media_refs,
  }));
}

const POST_TABLE_COLUMNS = postColumns<PostTableRow>({ summaryField: 'content', summaryLabel: 'Content', showEntities: false });

function PostsTableWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  const rows = useMemo(() => toPostTableRows(posts), [posts]);
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <DataTable
        data={rows}
        columns={POST_TABLE_COLUMNS}
        getRowKey={(r) => r.post_id}
        defaultSortKey="views"
        defaultSortDir="desc"
        pageSize={25}
        renderExpandedRow={(row) => <ExpandedPostRow row={row} />}
        emptyMessage="No posts to display"
      />
    </SocialWidgetFrame>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────────

interface SocialWidgetRendererProps {
  widget: SocialDashboardWidget;
  /** Already globally filtered posts */
  filteredPosts: DashboardPost[];
  isEditMode: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onFilterToggle?: (key: string, value: string) => void;
  serverKpis?: DashboardKpis;
  onAutoSize?: (i: string, h: number) => void;
}

export function SocialWidgetRenderer({
  widget: rawWidget,
  filteredPosts,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  serverKpis,
  onAutoSize,
}: SocialWidgetRendererProps) {
  // Legacy aggregations (`volume`, `sentiment-over-time`) are rewritten to
  // `aggregation: 'custom'` here so the dispatch below stays uniform.
  const widget = useMemo(() => normalizeWidgetAggregation(rawWidget), [rawWidget]);

  const widgetPosts = useMemo(
    () => applyWidgetFilters(filteredPosts, widget.filters),
    [filteredPosts, widget.filters],
  );

  const frameProps = { widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize };

  if (widget.aggregation === 'text') {
    return <TextWidget {...frameProps} />;
  }
  if (widget.aggregation === 'posts') {
    return <PostsTableWidget {...frameProps} posts={widgetPosts} />;
  }
  if (widget.aggregation === 'custom') {
    return <CustomWidget {...frameProps} posts={widgetPosts} onFilterToggle={onFilterToggle} />;
  }
  if (widget.chartType === 'number-card') {
    return <KpiWidget {...frameProps} posts={widgetPosts} serverKpis={serverKpis} />;
  }
  if (widget.chartType === 'word-cloud') {
    return <WordCloudWidget {...frameProps} posts={widgetPosts} onFilterToggle={onFilterToggle} />;
  }
  if (widget.aggregation === 'entities') {
    return <EntityWidget {...frameProps} posts={widgetPosts} onFilterToggle={onFilterToggle} />;
  }
  if (widget.aggregation === 'channels') {
    return <ChannelWidget {...frameProps} posts={widgetPosts} onFilterToggle={onFilterToggle} />;
  }
  return <GenericChartWidget {...frameProps} posts={widgetPosts} />;
}
