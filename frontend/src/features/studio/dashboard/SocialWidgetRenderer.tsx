import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardKpis, DashboardPost, TopicMetric } from '../../../api/types.ts';
import type { SocialDashboardWidget, WidgetData, FilterCondition, FilterConditionField, CustomMetric, AnyMetric, CustomTableConfig, CustomDimension, DataSource, TableColumnViz, TableColumnDisplay } from './types-social-dashboard.ts';
import { NUMERIC_CONDITION_FIELDS, DATE_CONDITION_FIELDS, METRIC_META, TOPIC_METRIC_META, normalizeWidgetAggregation, defaultTableConfigFor, defaultTopicTableConfig, autoColumnHeader, isDimensionColumn, isPostFieldColumn, getPostFieldMeta, normalizeTableConfig, objectFieldOf, objectFieldOfTable } from './types-social-dashboard.ts';
import { aggregateTopicsCustom, aggregateTopicsTable } from './topic-aggregations.ts';
import { aggregateObjectList, aggregateObjectTable } from './object-list-aggregations.ts';
import {
  ExternalLinkCell,
  PlatformCell,
  HandleCell,
  SentimentBadge,
  ThemeChips,
  EntityChips,
  TimeAgoCell,
  ContentPreview,
} from '../../../components/DataTable/cells.tsx';
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
import { PostEmbed } from './PostEmbed.tsx';
import { EmbedCarousel } from './EmbedCarousel.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import { Copy, MoreVertical, Settings2, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils.ts';

// ── Configurable table widget ─────────────────────────────────────────────────

/** Map a dimension to the dashboard filter key - used to wire row-click
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

interface ColumnStats {
  max: number;
  total: number;
}

/** Per-column max + total over the rendered rows. Max scales bar/heatmap viz;
 *  total is the denominator for `display: 'pct' | 'abs_pct'`. Skipped for
 *  non-numeric columns (dimension cols with 'top' agg). */
function computeColumnStats(
  tableConfig: CustomTableConfig,
  rows: TableRow[],
): Record<string, ColumnStats> {
  const stats: Record<string, ColumnStats> = {};
  for (const col of tableConfig.columns) {
    const isDim = isDimensionColumn(col);
    const isNumeric = !isDim;
    if (!isNumeric) continue;
    const needsMax = col.viz === 'bar' || col.viz === 'heatmap';
    const needsTotal = col.display === 'pct' || col.display === 'abs_pct';
    if (!needsMax && !needsTotal) continue;
    let max = 0;
    let total = 0;
    for (const row of rows) {
      const v = Number(row[col.id] ?? 0);
      if (!Number.isFinite(v)) continue;
      if (v > max) max = v;
      total += v;
    }
    stats[col.id] = { max, total };
  }
  return stats;
}

function formatPct(value: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%';
  const p = (value / total) * 100;
  // 1dp under 10%, none above - keeps narrow columns tidy.
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/** Format a numeric cell's text per `display`. Default 'abs'. */
function formatCell(value: number, display: TableColumnDisplay | undefined, total: number): string {
  if (display === 'pct') return formatPct(value, total);
  if (display === 'abs_pct') return `${formatNumber(value)} (${formatPct(value, total)})`;
  return formatNumber(value);
}

/** Render a numeric cell. When `viz` is set and `max > 0`, overlay an inline
 *  bar (right-aligned, scaled to column max) or shade the cell as a heatmap.
 *  Negative margins escape the DataTable's `cellPadX`/`cellPadY` so the bar /
 *  shading reach the cell edges for a clean column-spanning look. */
function renderNumericCell(
  value: number,
  viz: TableColumnViz | undefined,
  display: TableColumnDisplay | undefined,
  stats: ColumnStats | undefined,
) {
  const max = stats?.max ?? 0;
  const total = stats?.total ?? 0;
  const text = formatCell(value, display, total);
  if (viz === 'bar' && max > 0) {
    const pct = Math.max(0, Math.min(1, value / max)) * 100;
    return (
      <div className="relative -mx-2 -my-1.5 px-2 py-1.5">
        <div
          className="absolute inset-y-1 left-2 right-2 rounded-sm bg-primary/15 pointer-events-none"
          style={{ width: `calc(${pct}% - 1rem)`, maxWidth: 'calc(100% - 1rem)' }}
        />
        <span className="relative tabular-nums">{text}</span>
      </div>
    );
  }
  if (viz === 'heatmap' && max > 0) {
    const pct = Math.max(0, Math.min(1, value / max));
    // 4% baseline so even zero rows are tinted; primary token = theme accent.
    // color-mix is used everywhere else in globals.css - --primary is hex, not
    // an hsl triplet, so `hsl(var(--primary) / alpha)` does not work.
    const mix = (4 + pct * 36).toFixed(1);
    return (
      <div
        className="relative -mx-2 -my-1.5 px-2 py-1.5 text-right"
        style={{ backgroundColor: `color-mix(in srgb, var(--primary) ${mix}%, transparent)` }}
      >
        <span className="tabular-nums">{text}</span>
      </div>
    );
  }
  return <span className="tabular-nums">{text}</span>;
}

function renameValue(raw: string, overrides?: Record<string, string>): string {
  const renamed = overrides?.[raw];
  return renamed != null && renamed !== '' ? renamed : raw;
}

function buildTableColumns(
  tableConfig: CustomTableConfig,
  columnStats: Record<string, ColumnStats>,
  labelOverrides?: Record<string, string>,
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

  // First dim column (if any) gets the channel/platform-icon treatment when
  // its dimension is `channel_handle`. Subsequent dim columns render plain.
  let dimColSeen = false;
  for (const col of tableConfig.columns) {
    if (isDimensionColumn(col)) {
      const isFirstDim = !dimColSeen;
      dimColSeen = true;
      const isChannel = col.dimension === 'channel_handle';
      cols.push({
        key: col.id,
        header: col.header || autoColumnHeader(col),
        align: 'left',
        // Label columns hold narrative text -> give them more room and let them
        // wrap to full height (no line cap) so the value is always fully visible.
        minWidth: isFirstDim ? 220 : 170,
        // String values: DataTable's header sort is numeric-only and would
        // scramble - fall back to aggregateTable's pre-sort by picking this
        // column in the config dialog's Sort by.
        sortable: false,
        render: (row) => {
          const raw = String(row[col.id] ?? '');
          const text = raw === '' ? '-' : renameValue(raw, labelOverrides);
          if (isChannel) {
            return (
              <div className="flex items-center gap-2 min-w-0">
                {isFirstDim && row.__platform && (
                  <PlatformIcon platform={row.__platform} className="h-3.5 w-3.5 shrink-0" />
                )}
                <span
                  className="text-[12px] font-medium text-foreground break-words"
                  title={raw === '' ? text : `@${text}`}
                >
                  {raw === '' ? text : `@${text}`}
                </span>
              </div>
            );
          }
          return (
            <span
              className={cn(
                'text-[12px] break-words',
                isFirstDim ? 'font-medium text-foreground' : 'text-foreground',
              )}
              title={text}
            >
              {text}
            </span>
          );
        },
      });
    } else {
      cols.push({
        key: col.id,
        header: col.header || autoColumnHeader(col),
        align: 'right',
        sortable: true,
        render: (row) =>
          renderNumericCell(Number(row[col.id] ?? 0), col.viz, col.display, columnStats[col.id]),
      });
    }
  }

  return cols;
}

/** Post-mode column builder: one row per post, columns read raw post fields.
 *  Render kind comes from `getPostFieldMeta(col.postField).render` so cell
 *  components stay in sync with the field set. */
function buildPostTableColumns(
  tableConfig: CustomTableConfig,
  columnStats: Record<string, ColumnStats>,
): ColumnDef<TableRow>[] {
  const cols: ColumnDef<TableRow>[] = [];
  if (tableConfig.showRank === true) {
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
  for (const col of tableConfig.columns) {
    if (!isPostFieldColumn(col) || !col.postField) continue;
    const meta = getPostFieldMeta(col.postField);
    const header = col.header || meta.label;
    const id = col.id;
    switch (meta.render) {
      case 'link':
        cols.push({
          key: id, header: header || '', width: 'w-8', sortable: false,
          render: (row) => <ExternalLinkCell url={String(row[id] ?? '')} />,
        });
        break;
      case 'date':
        cols.push({
          key: id, header, width: 'w-[8%]', sortable: true,
          render: (row) => <TimeAgoCell date={String(row[id] ?? '')} />,
        });
        break;
      case 'platform':
        cols.push({
          key: id, header, width: 'w-[9%]', sortable: false,
          render: (row) => <PlatformCell platform={String(row[id] ?? '')} />,
        });
        break;
      case 'handle':
        cols.push({
          key: id, header, width: 'w-[11%]', sortable: false,
          render: (row) => <HandleCell handle={String(row[id] ?? '')} />,
        });
        break;
      case 'sentiment':
        cols.push({
          key: id, header, width: 'w-[8%]', sortable: false,
          render: (row) => <SentimentBadge sentiment={String(row[id] ?? '') || undefined} />,
        });
        break;
      case 'badge':
        cols.push({
          key: id, header, sortable: false,
          render: (row) => {
            const v = String(row[id] ?? '');
            if (!v) return <span className="text-muted-foreground/40">-</span>;
            return (
              <span className="inline-block truncate rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                {v}
              </span>
            );
          },
        });
        break;
      case 'array': {
        const useTheme = col.postField === 'themes';
        cols.push({
          key: id, header, sortable: false,
          render: (row) => {
            const v = row[id];
            const arr = Array.isArray(v) ? v : (v ? [String(v)] : []);
            return useTheme
              ? <ThemeChips themes={arr} max={3} />
              : <EntityChips entities={arr} max={3} />;
          },
        });
        break;
      }
      case 'content':
        cols.push({
          key: id, header, sortable: false,
          render: (row) => <ContentPreview text={typeof row[id] === 'string' ? (row[id] as string) : ''} />,
        });
        break;
      case 'numeric':
        cols.push({
          key: id, header, align: 'right', sortable: true,
          render: (row) => renderNumericCell(Number(row[id] ?? 0), col.viz, col.display, columnStats[id]),
        });
        break;
      default:
        cols.push({
          key: id, header, sortable: false,
          render: (row) => {
            const v = row[id];
            if (v == null || v === '') return <span className="text-muted-foreground/40">-</span>;
            const s = Array.isArray(v) ? v.join(', ') : String(v);
            return <span className="break-words text-[12px]" title={s}>{s}</span>;
          },
        });
    }
  }
  return cols;
}

function ConfigurableTableWidget({
  posts,
  topics,
  dataSource = 'posts',
  tableConfig: rawTableConfig,
  onFilterToggle,
  onTopicNavigate,
  labelOverrides,
}: {
  posts: DashboardPost[];
  topics?: TopicMetric[];
  dataSource?: DataSource;
  tableConfig: CustomTableConfig;
  onFilterToggle?: (key: string, value: string) => void;
  onTopicNavigate?: (clusterId: string) => void;
  labelOverrides?: Record<string, string>;
}) {
  const tableConfig = useMemo(() => normalizeTableConfig(rawTableConfig), [rawTableConfig]);
  const isTopicsSource = dataSource === 'topics';
  const rows = useMemo(
    () => {
      // Element-as-unit object table when columns reference a list[object] field.
      const objField = !isTopicsSource ? objectFieldOfTable(tableConfig) : null;
      if (objField) return aggregateObjectTable(posts, objField, tableConfig);
      return isTopicsSource
        ? aggregateTopicsTable(topics ?? [], tableConfig)
        : aggregateTable(posts, tableConfig);
    },
    [isTopicsSource, posts, topics, tableConfig],
  );
  const columnStats = useMemo(() => computeColumnStats(tableConfig, rows), [tableConfig, rows]);
  const isPostMode = tableConfig.mode === 'post';
  const columns = useMemo(
    () => isPostMode
      ? buildPostTableColumns(tableConfig, columnStats)
      : buildTableColumns(tableConfig, columnStats, labelOverrides),
    [isPostMode, tableConfig, columnStats, labelOverrides],
  );
  // Row-click filtering (group mode only): use the first dim column whose
  // dimension maps to a filter key. Post mode rows have no group identity to
  // filter on; clicks fall through to the link cell instead.
  const firstDimCol = isPostMode ? undefined : tableConfig.columns.find(isDimensionColumn);
  // For topic widgets, the row's __key IS the cluster_id (set by
  // aggregateTopicsTable). When `onTopicNavigate` is supplied, route row
  // clicks to navigation; otherwise (e.g. public share with no auth) they
  // are inert.
  const filterKey = !isTopicsSource && firstDimCol?.dimension
    ? filterKeyForDimension(firstDimCol.dimension as CustomDimension)
    : undefined;
  // When the active sort key produces strings (any dim column), rely on
  // aggregateTable's pre-sort - DataTable's sort is numeric-only and would
  // scramble the order.
  const sortBy = tableConfig.sortBy ?? tableConfig.columns[0]?.id;
  const sortCol = tableConfig.columns.find((c) => c.id === sortBy);
  const sortIsString = sortCol != null && (
    isDimensionColumn(sortCol)
    || (isPostMode && isPostFieldColumn(sortCol) && getPostFieldMeta(sortCol.postField).render !== 'numeric')
  );
  const defaultSortKey = sortIsString ? undefined : sortBy;

  return (
    <DataTable<TableRow>
      data={rows}
      columns={columns}
      getRowKey={(r) => r.__key}
      defaultSortKey={defaultSortKey}
      defaultSortDir={tableConfig.sortDir ?? 'desc'}
      pageSize={tableConfig.rowLimit ?? (isPostMode ? 50 : 25)}
      // Defaults chosen to match the original Top Channels look:
      // generous row padding, no stripes - the user can tweak both in the
      // Style tab.
      density={tableConfig.density ?? 'comfortable'}
      striped={tableConfig.striped ?? false}
      emptyMessage="No data"
      onRowClick={
        isTopicsSource && onTopicNavigate
          ? (r) => {
              if (r.__key) onTopicNavigate(r.__key);
            }
          : filterKey && firstDimCol && onFilterToggle
            ? (r) => {
                const v = r[firstDimCol.id];
                if (typeof v === 'string' && v) onFilterToggle(filterKey, v);
              }
            : undefined
      }
    />
  );
}

// ── Generic table for custom widgets ──────────────────────────────────────────

function GenericTableView({
  data,
  labelOverrides,
}: {
  data: WidgetData | undefined;
  labelOverrides?: Record<string, string>;
}) {
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
              <td className="px-2 py-1.5 truncate max-w-[200px]">{renameValue(label, labelOverrides)}</td>
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
    if (filters.channel_type?.length && !filters.channel_type.includes(p.channel_type || '')) return false;
    if (filters.collection?.length && !filters.collection.includes(p.collection_id)) return false;
    if (filters.channels?.length && !filters.channels.includes(p.channel_handle || '')) return false;
    if (filters.themes?.length && !filters.themes.some((t) => (p.themes ?? []).includes(t))) return false;
    if (filters.entities?.length && !filters.entities.some((e) => (p.entities ?? []).includes(e))) return false;
    if (filters.brands?.length && !filters.brands.some((b) => (p.detected_brands ?? []).includes(b))) return false;
    if (filters.custom_fields) {
      for (const [name, selected] of Object.entries(filters.custom_fields)) {
        if (!selected?.length) continue;
        const dot = name.indexOf('.');
        if (dot >= 0) {
          // list[object] leaf filter (men.name): keep the post if ANY element's
          // leaf value is selected. Field names never contain dots, so the dot
          // unambiguously marks an object leaf.
          const field = name.slice(0, dot);
          const leaf = name.slice(dot + 1);
          const raw = p.custom_fields?.[field];
          if (!Array.isArray(raw)) return false;
          const vals = raw
            .filter((e) => e && typeof e === 'object' && !Array.isArray(e))
            .map((e) => String((e as Record<string, unknown>)[leaf]));
          if (!selected.some((s) => vals.includes(s))) return false;
          continue;
        }
        const raw = p.custom_fields?.[name];
        if (raw == null) return false;
        const postVals = Array.isArray(raw) ? raw.map((v) => String(v)) : [String(raw)];
        if (!selected.some((s) => postVals.includes(s))) return false;
      }
    }
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
          labelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialProgressListWidget
        data={listData}
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
      />
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
          labelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialProgressListWidget
        data={listData}
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
      />
    </SocialWidgetFrame>
  );
}

function CustomWidget({
  widget,
  posts,
  topics,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  onTopicNavigate,
}: FrameProps & {
  posts: DashboardPost[];
  topics?: TopicMetric[];
  onFilterToggle?: (key: string, value: string) => void;
  onTopicNavigate?: (clusterId: string) => void;
}) {
  const config = widget.customConfig;
  const dataSource: DataSource = widget.dataSource ?? 'posts';
  const isTopicsSource = dataSource === 'topics';

  // Optional viewer-facing metric toggle. The persisted `metric` is the
  // initial selection; the toggle list normally contains it.
  const toggleMetrics = (config?.metricToggle?.length ?? 0) >= 2 ? config!.metricToggle! : undefined;
  const [activeMetric, setActiveMetric] = useState<AnyMetric>(() => config?.metric ?? 'post_count');
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
    // list[object] fields aggregate element-as-unit on the posts source - check
    // before the topics branch since object tokens live inside `dataSource:posts`.
    const objField = objectFieldOf(effectiveConfig);
    if (objField) return aggregateObjectList(posts, objField, effectiveConfig);
    return isTopicsSource
      ? aggregateTopicsCustom(topics ?? [], effectiveConfig)
      : aggregateCustom(posts, effectiveConfig);
  }, [isTopicsSource, posts, topics, effectiveConfig]);

  const cloudData = useMemo(() => {
    if (!data?.labels || !data.values) return [];
    return data.labels.map((text, i) => ({ text, value: data.values![i] }));
  }, [data]);

  const syntheticKpi = useMemo(
    () => ({ label: widget.title, value: data?.value ?? 0, icon: 'posts' as const, sparklineData: [] }),
    [widget.title, data?.value],
  );

  const metricLabel = (m: AnyMetric): string => {
    if (isTopicsSource) {
      return TOPIC_METRIC_META[m as keyof typeof TOPIC_METRIC_META]?.label ?? String(m);
    }
    return METRIC_META[m as CustomMetric]?.label ?? String(m);
  };

  const headerAction = toggleMetrics ? (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
      {toggleMetrics.map((m, i) => (
        <button
          key={m as string}
          type="button"
          onClick={() => setActiveMetric(m)}
          className={`px-2 py-0.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
            activeMetric === m
              ? 'bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          {metricLabel(m)}
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
          seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'table') {
    // Prefer the configurable table (multi-column, sortable, picks columns).
    // If the widget has no tableConfig but its dimension matches a known
    // preset (channel_handle / entities), synthesize defaults so legacy
    // widgets keep rendering the rich design without losing functionality.
    // For topics widgets, defaultTableConfigFor is post-side; fall through to
    // a topics-aware default below.
    const tableConfig = widget.tableConfig
      ?? (!isTopicsSource && config.dimension
        ? defaultTableConfigFor(config.dimension as CustomDimension)
        : isTopicsSource
          ? defaultTopicTableConfig()
          : undefined);
    if (tableConfig) {
      return (
        <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
          <ConfigurableTableWidget
            posts={posts}
            topics={topics}
            dataSource={dataSource}
            tableConfig={tableConfig}
            onFilterToggle={onFilterToggle}
            onTopicNavigate={onTopicNavigate}
            labelOverrides={widget.styleOverrides?.seriesLabels}
          />
        </SocialWidgetFrame>
      );
    }
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} headerAction={headerAction}>
        <GenericTableView data={data ?? undefined} labelOverrides={widget.styleOverrides?.seriesLabels} />
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
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        barOrientation={widget.customConfig?.barOrientation}
        stacked={widget.customConfig?.stacked ?? true}
        timeBucket={widget.customConfig?.timeBucket}
        centerLabel={metricLabel(activeMetric)}
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
        <SocialProgressListWidget
          data={chartData ?? undefined}
          seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        />
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
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        barOrientation={widget.customConfig?.barOrientation}
        centerLabel="Posts"
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
          Empty text card - click the gear to add markdown
        </div>
      )}
    </div>
  );
}

// ── Embed Posts widget ────────────────────────────────────────────────────────
// Single URL → one embed; 2+ URLs → carousel. Mode is auto-derived, the user
// never picks. Uses SocialWidgetFrame for chrome and auto-size like TextWidget.

function EmbedsWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize }: FrameProps) {
  const urls = (widget.embedUrls ?? []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onAutoSize || !contentRef.current) return;
    const ROW_HEIGHT_PX = 48;
    const MARGIN_Y_PX = 6;
    const BOTTOM_PAD_PX = 24;
    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!contentRef.current) return;
        const contentH = contentRef.current.scrollHeight;
        const cellPx = contentH + BOTTOM_PAD_PX;
        const targetH = Math.max(4, Math.ceil(cellPx / (ROW_HEIGHT_PX + MARGIN_Y_PX)));
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
  }, [widget.i, widget.h, urls.length, onAutoSize]);

  return (
    <SocialWidgetFrame
      title={widget.title}
      description={widget.description}
      figureText={widget.figureText}
      isEditMode={isEditMode}
      onConfigure={onConfigure}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    >
      <div ref={contentRef} className="w-full" data-embed-widget="1">
        {urls.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground italic">
            Empty embed card - click the gear to add post URLs
          </div>
        ) : urls.length === 1 ? (
          <div className="flex justify-center">
            <PostEmbed url={urls[0]} />
          </div>
        ) : (
          <EmbedCarousel urls={urls} />
        )}
      </div>
    </SocialWidgetFrame>
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
  /** Agent-scoped topic_metrics rows. Optional - widgets with
   *  `dataSource: 'posts'` ignore this. Empty array when no agent context. */
  topics?: TopicMetric[];
  isEditMode: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onFilterToggle?: (key: string, value: string) => void;
  /** Called when a topic widget item is clicked. Undefined disables
   *  click-through (e.g. on public/shared dashboards). */
  onTopicNavigate?: (clusterId: string) => void;
  serverKpis?: DashboardKpis;
  onAutoSize?: (i: string, h: number) => void;
}

export function SocialWidgetRenderer({
  widget: rawWidget,
  filteredPosts,
  topics,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  onTopicNavigate,
  serverKpis,
  onAutoSize,
}: SocialWidgetRendererProps) {
  // Legacy aggregations (`volume`, `sentiment-over-time`) are rewritten to
  // `aggregation: 'custom'` here so the dispatch below stays uniform.
  // Topic widgets are always custom - coerce here so any stale config
  // (e.g. an agent-emitted layout that set `aggregation: 'kpi'`) routes
  // through the custom path which knows how to read topic data.
  const widget = useMemo(() => {
    const normalized = normalizeWidgetAggregation(rawWidget);
    if (
      (normalized.dataSource ?? 'posts') === 'topics'
      && normalized.aggregation !== 'text'
      && normalized.aggregation !== 'embeds'
    ) {
      return { ...normalized, aggregation: 'custom' as const };
    }
    return normalized;
  }, [rawWidget]);

  const widgetPosts = useMemo(
    () => applyWidgetFilters(filteredPosts, widget.filters),
    [filteredPosts, widget.filters],
  );

  const frameProps = { widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize };

  if (widget.aggregation === 'text') {
    return <TextWidget {...frameProps} />;
  }
  if (widget.aggregation === 'embeds') {
    return <EmbedsWidget {...frameProps} />;
  }
  if (widget.aggregation === 'posts') {
    return <PostsTableWidget {...frameProps} posts={widgetPosts} />;
  }
  if (widget.aggregation === 'custom') {
    return (
      <CustomWidget
        {...frameProps}
        posts={widgetPosts}
        topics={topics}
        onFilterToggle={onFilterToggle}
        onTopicNavigate={onTopicNavigate}
      />
    );
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
