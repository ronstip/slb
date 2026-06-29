import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardKpis, DashboardPost, TopicMetric } from '../../../api/types.ts';
import type { SocialDashboardWidget, WidgetData, FilterCondition, FilterConditionField, CustomMetric, AnyMetric, CustomTableConfig, CustomDimension, DataSource, TableColumnViz, TableColumnDisplay, ComputedField } from './types-social-dashboard.ts';
import { DATE_CONDITION_FIELDS, isPostCountCondition, isCustomFieldDimension, customFieldName, METRIC_META, TOPIC_METRIC_META, normalizeWidgetAggregation, defaultTableConfigFor, defaultTopicTableConfig, autoColumnHeader, isDimensionColumn, isPostFieldColumn, getPostFieldMeta, getDimensionMeta, normalizeTableConfig, objectFieldOf, objectFieldOfTable, isBrandDimension, defaultAxisTitles } from './types-social-dashboard.ts';
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
import { aggregateCustom, aggregateHeatmap, aggregateTable, aggregateTableBreakdown, getDimensionKeys, BREAKDOWN_DIM_ID, type TableRow } from './dashboard-aggregations.ts';
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
import { resolveSparklineEnabled, toCumulativeSeries } from './sparkline-visibility.ts';
import { shouldAutoSizeWidget } from './text-card-sizing.ts';
import { widgetContainerVisible, cardScrollWrapperClass, autoSizeBottomPadPx } from './widget-container.ts';
import { sanitizeWidgetHtml } from './widget-html.ts';
import type { ColumnDef } from '../../../components/DataTable/DataTable.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { BrandIcon } from '../../../components/BrandIcon.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { mediaServeUrl } from '../../../api/client.ts';
import { SocialChartWidget } from './SocialChartWidget.tsx';
import { SocialHeatmapWidget } from './SocialHeatmapWidget.tsx';
import { SocialKpiCard } from './SocialKpiCard.tsx';
import { SocialProgressListWidget } from './SocialProgressListWidget.tsx';
import { SocialWordCloudWidget } from './SocialWordCloudWidget.tsx';
import { SocialWidgetFrame } from './SocialWidgetFrame.tsx';
import { DataTable } from '../../../components/DataTable/DataTable.tsx';
import { postColumns } from '../../../components/DataTable/columns.tsx';
import { ExpandedPostRow } from '../../../components/DataTable/ExpandedPostRow.tsx';
import { usePostDetails } from './use-post-details.tsx';
import { Markdown } from '../../../components/Markdown.tsx';
import { PostEmbed } from './PostEmbed.tsx';
import { EmbedCarousel } from './EmbedCarousel.tsx';
import { EmbedPostGallery } from './EmbedPostGallery.tsx';
import { resolveEmbedPosts } from './embed-posts.ts';
import { DEFAULT_EMBED_RANK } from './types-social-dashboard.ts';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import {
  Copy, MoreVertical, Settings2, Trash2,
  Heart, Globe, Tag, Smile, Layers, Users, Activity, Hash,
  PieChart, BarChart3, Table2, Cloud, ListFilter, Share2, CalendarDays,
} from 'lucide-react';
import { cn } from '../../../lib/utils.ts';

/** Small accent glyph shown before a widget title (design's widget icons).
 *  Keyed by the widget's semantic aggregation first, then its chart type. */
function widgetHeaderIcon(widget: SocialDashboardWidget): React.ReactNode {
  const sw = 1.9;
  const byAgg: Record<string, React.ReactNode> = {
    sentiment: <Heart strokeWidth={sw} />,
    platform: <Globe strokeWidth={sw} />,
    themes: <Tag strokeWidth={sw} />,
    'theme-cloud': <Tag strokeWidth={sw} />,
    emotion: <Smile strokeWidth={sw} />,
    'content-type': <Layers strokeWidth={sw} />,
    language: <Globe strokeWidth={sw} />,
    entities: <Tag strokeWidth={sw} />,
    channels: <Users strokeWidth={sw} />,
    'engagement-rate': <Activity strokeWidth={sw} />,
    posts: <Table2 strokeWidth={sw} />,
  };
  if (widget.aggregation && byAgg[widget.aggregation]) return byAgg[widget.aggregation];
  switch (widget.chartType) {
    case 'doughnut':
    case 'pie': return <PieChart strokeWidth={sw} />;
    case 'bar': return <BarChart3 strokeWidth={sw} />;
    case 'line': return <Activity strokeWidth={sw} />;
    case 'table': return <Table2 strokeWidth={sw} />;
    case 'word-cloud': return <Cloud strokeWidth={sw} />;
    case 'progress-list': return <ListFilter strokeWidth={sw} />;
    case 'heatmap': return <CalendarDays strokeWidth={sw} />;
    case 'number-card': return <Hash strokeWidth={sw} />;
    default: return <Share2 strokeWidth={sw} />;
  }
}

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

  const rankShown = tableConfig.showRank !== false;
  if (rankShown) {
    cols.push({
      key: '__rank',
      header: '#',
      width: 'w-10',
      sortable: false,
      // Pin the rank gutter so wide tables keep their row anchor while the
      // metric columns scroll horizontally on mobile.
      sticky: true,
      stickyLeftPx: 0,
      render: (_row, idx) => (
        <span className="text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</span>
      ),
    });
  }

  // First dim column (if any) gets the channel/platform-icon treatment when
  // its dimension is `channel_handle`. Subsequent dim columns render plain.
  // Cell text size is left to the table's `fontSize`; the identity column's
  // weight is configurable via `emphasizeFirstColumn`.
  const firstDimWeight = tableConfig.emphasizeFirstColumn ? 'font-bold' : 'font-medium';
  let dimColSeen = false;
  for (const col of tableConfig.columns) {
    if (isDimensionColumn(col)) {
      const isFirstDim = !dimColSeen;
      dimColSeen = true;
      const isChannel = col.dimension === 'channel_handle';
      const isBrand = isBrandDimension(col.dimension);
      cols.push({
        key: col.id,
        header: col.header || autoColumnHeader(col),
        align: 'left',
        // Pin the first label column (the row's identity) so it stays visible
        // while metric columns scroll horizontally on mobile. Offset past the
        // rank gutter (w-10 = 40px) when it's shown.
        sticky: isFirstDim,
        stickyLeftPx: isFirstDim ? (rankShown ? 40 : 0) : undefined,
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
                  className={cn('break-words text-foreground', isFirstDim ? firstDimWeight : '')}
                  title={raw === '' ? text : `@${text}`}
                >
                  {raw === '' ? text : `@${text}`}
                </span>
              </div>
            );
          }
          if (isBrand && raw !== '') {
            return (
              <div className="flex items-center gap-2 min-w-0">
                <BrandIcon brand={raw} className="h-3.5 w-3.5 shrink-0" />
                <span
                  className={cn(
                    'break-words',
                    isFirstDim ? `${firstDimWeight} text-foreground` : 'text-foreground',
                  )}
                  title={text}
                >
                  {text}
                </span>
              </div>
            );
          }
          return (
            <span
              className={cn(
                'break-words',
                isFirstDim ? `${firstDimWeight} text-foreground` : 'text-foreground',
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

/** First group-by dimension of a grouped table - resolves a `post_count`
 *  (min group size) condition against the table's own rows. */
export function tablePrimaryDimension(tableConfig: CustomTableConfig): CustomDimension | undefined {
  const dimCol = tableConfig.columns.find(isDimensionColumn);
  return dimCol?.dimension as CustomDimension | undefined;
}

function ConfigurableTableWidget({
  posts,
  filters,
  topics,
  dataSource = 'posts',
  tableConfig: rawTableConfig,
  onFilterToggle,
  onTopicNavigate,
  labelOverrides,
  serverRows,
  serverPostIds,
}: {
  posts: DashboardPost[];
  filters?: SocialDashboardWidget['filters'];
  topics?: TopicMetric[];
  dataSource?: DataSource;
  tableConfig: CustomTableConfig;
  onFilterToggle?: (key: string, value: string) => void;
  onTopicNavigate?: (clusterId: string) => void;
  labelOverrides?: Record<string, string>;
  /** P2: server-computed rows (public share). Used verbatim when present,
   *  skipping client aggregation. */
  serverRows?: TableRow[];
  /** P2: for a POST-mode table, the server-selected bounded post ids (numeric
   *  sort). When the omit-gate drops the global posts to the feed union, this
   *  picks THIS table's posts out of that union before re-rendering rows. */
  serverPostIds?: string[];
}) {
  const tableConfig = useMemo(() => normalizeTableConfig(rawTableConfig), [rawTableConfig]);
  const isTopicsSource = dataSource === 'topics';
  // Post-mode + server feed: restrict to this widget's bounded post set (the
  // global `posts` is the combined feed union across all widgets, so we must
  // pick out ours by id before aggregateTablePostMode re-renders its rows).
  const postModePosts = useMemo(() => {
    if (!serverPostIds || tableConfig.mode !== 'post') return posts;
    const byId = new Map(posts.map((p) => [p.post_id, p]));
    return serverPostIds.map((id) => byId.get(id)).filter((p): p is DashboardPost => !!p);
  }, [serverPostIds, tableConfig.mode, posts]);
  const rows = useMemo(
    () => {
      if (serverRows) return serverRows;
      // Grouped tables aggregate by dimension, so prune multi-valued fields to
      // the selected values (value-level filter). Post-mode tables show raw
      // posts as rows - leave their values intact.
      const isGrouped = !isTopicsSource && tableConfig.mode !== 'post';
      const aggPosts = isGrouped
        ? applyWidgetValueFilters(postModePosts, filters, tablePrimaryDimension(tableConfig))
        : postModePosts;
      // Element-as-unit object table when columns reference a list[object] field.
      const objField = !isTopicsSource ? objectFieldOfTable(tableConfig) : null;
      if (objField) return aggregateObjectTable(aggPosts, objField, tableConfig);
      return isTopicsSource
        ? aggregateTopicsTable(topics ?? [], tableConfig)
        : aggregateTable(aggPosts, tableConfig);
    },
    [isTopicsSource, postModePosts, filters, topics, tableConfig, serverRows],
  );
  const columnStats = useMemo(() => computeColumnStats(tableConfig, rows), [tableConfig, rows]);
  const isPostMode = tableConfig.mode === 'post';
  const columns = useMemo(
    () => isPostMode
      ? buildPostTableColumns(tableConfig, columnStats)
      : buildTableColumns(tableConfig, columnStats, labelOverrides),
    [isPostMode, tableConfig, columnStats, labelOverrides],
  );
  // Lazy-merge the `ai_summary` post-field column: it's stripped from the slim
  // payload, so for a post-mode table fetch it for the displayed (bounded) rows
  // and fill those cells in once it arrives. No-op when there's no such column
  // (or when the value is already present, e.g. the full/non-slim payload).
  const aiSummaryColIds = useMemo(
    () =>
      isPostMode
        ? tableConfig.columns
            .filter((c) => isPostFieldColumn(c) && c.postField === 'ai_summary')
            .map((c) => c.id)
        : [],
    [isPostMode, tableConfig.columns],
  );
  const detailPostIds = useMemo(
    () => (aiSummaryColIds.length > 0 ? rows.map((r) => r.__key) : []),
    [aiSummaryColIds.length, rows],
  );
  const { get: getPostDetail, version: detailVersion } = usePostDetails(detailPostIds);
  const displayRows = useMemo(() => {
    if (aiSummaryColIds.length === 0) return rows;
    return rows.map((r) => {
      const d = getPostDetail(r.__key);
      if (!d || d.ai_summary == null) return r;
      const next = { ...r };
      for (const colId of aiSummaryColIds) {
        if (next[colId] == null) next[colId] = d.ai_summary;
      }
      return next;
    });
    // detailVersion drives re-resolution as fetched details land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, aiSummaryColIds, getPostDetail, detailVersion]);
  // Optional per-group breakdown (opt-in via tableConfig.breakdownDimension).
  // Grouped post tables only - not topics or element-as-unit object tables.
  const breakdownDim = tableConfig.breakdownDimension;
  const breakdownMap = useMemo(() => {
    if (isTopicsSource || isPostMode || !breakdownDim) return null;
    if (objectFieldOfTable(tableConfig)) return null;
    const aggPosts = applyWidgetValueFilters(posts, filters, tablePrimaryDimension(tableConfig));
    return aggregateTableBreakdown(aggPosts, tableConfig);
  }, [isTopicsSource, isPostMode, breakdownDim, posts, filters, tableConfig]);
  const breakdownMetricCols = useMemo(
    () => tableConfig.columns.filter((c) => !isDimensionColumn(c) && c.metric),
    [tableConfig],
  );
  const breakdownHeader = breakdownDim ? getDimensionMeta(breakdownDim).label : '';
  const renderBreakdown = (row: TableRow) => {
    const sub = breakdownMap?.get(row.__key) ?? [];
    if (sub.length === 0) {
      return <div className="py-1 text-xs text-muted-foreground italic">No breakdown data</div>;
    }
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-3 text-left font-medium">{breakdownHeader}</th>
            {breakdownMetricCols.map((c) => (
              <th key={c.id} className="py-1 pl-3 text-right font-medium">{c.header || autoColumnHeader(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sub.map((r) => (
            <tr key={r.__key} className="border-t border-border/30">
              <td className="py-1 pr-3 text-foreground break-words">
                {renameValue(String(r[BREAKDOWN_DIM_ID] ?? ''), labelOverrides) || '-'}
              </td>
              {breakdownMetricCols.map((c) => (
                <td key={c.id} className="py-1 pl-3 text-right tabular-nums">
                  {formatNumber(Number(r[c.id] ?? 0))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

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
      data={displayRows}
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
      fontSize={tableConfig.fontSize ?? 'xs'}
      accentColor={tableConfig.accent}
      headerBold={tableConfig.headerBold}
      columnWidth={tableConfig.columnWidth ?? 'equal'}
      surfaceColor="var(--widget-surface)"
      emptyMessage="No data"
      renderExpandedRow={breakdownMap ? renderBreakdown : undefined}
      onRowClick={
        // Breakdown expansion owns the row click - skip filter/navigate so a
        // click only toggles the drill-down.
        breakdownMap
          ? undefined
          : isTopicsSource && onTopicNavigate
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
    if (filters.topics?.length && !filters.topics.some((t) => (p.topic_ids ?? []).includes(t))) return false;
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

/** Dimension values whose post count satisfies a `post_count` condition. Counts
 *  each post once per distinct value (matching the aggregators' grouping). */
function postCountAllowedValues(
  posts: DashboardPost[],
  cond: FilterCondition,
  dim: CustomDimension,
): Set<string> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const v of new Set(conditionDimensionKeys(p, dim))) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const cv = Number(cond.value);
  const cv2 = Number(cond.value2 ?? cond.value);
  const allowed = new Set<string>();
  for (const [v, c] of counts) {
    let ok = false;
    switch (cond.operator) {
      case 'greaterThan': ok = c > cv; break;
      case 'lessThan': ok = c < cv; break;
      case 'equals': ok = c === cv; break;
      case 'between': ok = c >= cv && c <= cv2; break;
    }
    if (ok) allowed.add(v);
  }
  return allowed;
}

/** Prune a post's values for a multi-valued dimension down to `allowed`. Scalar
 *  dimensions can't be partially pruned (one value) so are returned untouched. */
function pruneDimValues(p: DashboardPost, dim: CustomDimension, allowed: Set<string>): DashboardPost {
  if (dim === 'themes') return { ...p, themes: (p.themes ?? []).filter((v) => allowed.has(v)) };
  if (dim === 'entities') return { ...p, entities: (p.entities ?? []).filter((v) => allowed.has(v)) };
  if (dim === 'brands') return { ...p, detected_brands: (p.detected_brands ?? []).filter((v) => allowed.has(v)) };
  if (isCustomFieldDimension(dim)) {
    const name = customFieldName(dim);
    const dot = name.indexOf('.');
    const cf = { ...(p.custom_fields ?? {}) };
    if (dot >= 0) {
      const field = name.slice(0, dot);
      const leaf = name.slice(dot + 1);
      const raw = cf[field];
      if (Array.isArray(raw)) {
        cf[field] = raw.filter((el) =>
          el && typeof el === 'object' && !Array.isArray(el)
          && allowed.has(String((el as Record<string, unknown>)[leaf])));
      }
    } else {
      const raw = cf[name];
      if (Array.isArray(raw)) cf[name] = raw.filter((v) => v != null && allowed.has(String(v)));
    }
    return { ...p, custom_fields: cf };
  }
  return p;
}

/**
 * Group-count row filter: each `post_count` condition hides aggregation groups
 * whose post count fails the threshold. For a scalar count-dimension this drops
 * the group's posts (removing the row); for a multi-valued dimension it prunes
 * each post's values to the surviving groups. Runs only on the aggregation layer
 * (callers of `applyWidgetValueFilters`), so raw post displays are untouched.
 */
function applyPostCountConditions(
  posts: DashboardPost[],
  conditions: FilterCondition[] | undefined,
  primaryDimension: CustomDimension | undefined,
): DashboardPost[] {
  // A post_count condition counts members of the widget's own groups. Resolve
  // each to the widget's primary grouping dimension (or a legacy explicit one);
  // with no grouping (e.g. number cards, raw lists) there is nothing to filter.
  const pcConds = (conditions ?? [])
    .filter(isPostCountCondition)
    .map((c) => ({ cond: c, dim: c.dimension ?? primaryDimension }))
    .filter((x): x is { cond: FilterCondition; dim: CustomDimension } => x.dim != null);
  if (pcConds.length === 0) return posts;
  let working = posts;
  for (const { cond, dim } of pcConds) {
    const allowed = postCountAllowedValues(working, cond, dim);
    const out: DashboardPost[] = [];
    for (const p of working) {
      const keys = conditionDimensionKeys(p, dim);
      if (keys.length === 0) continue; // not in any counted group → drop
      const kept = keys.filter((k) => allowed.has(k));
      if (kept.length === 0) continue; // whole group(s) below threshold → drop
      if (kept.length === keys.length) { out.push(p); continue; }
      out.push(pruneDimValues(p, dim, allowed)); // partial (multi-valued) → prune
    }
    working = out;
  }
  return working;
}

/**
 * Value-level filtering for multi-valued dimensions. `applyWidgetFilters` is a
 * ROW filter: it keeps a whole post when ANY of its values matches the
 * selection - which leaves the post's *other* values in place. A breakdown of
 * that same field then still counts the unselected values (a post tagged
 * [pricing, support] filtered to [pricing] would still add to "support").
 *
 * This pass prunes each multi-valued field down to its selected values so the
 * aggregators count only what was filtered. Apart from `post_count` group-count
 * conditions (which intentionally drop whole groups), it never drops a post -
 * callers pass row-filtered posts, so a match is already guaranteed; pruning to
 * [] is fine. Scalar fields are untouched - their row filter already equals a
 * value filter, and raw post displays (posts table, post-mode table) must not
 * feed through this - they should show the post's true values.
 *
 * Returns the same array reference when nothing is filtered, and the same post
 * reference for posts that needed no pruning, so memoized consumers stay cheap.
 */
export function applyWidgetValueFilters(
  posts: DashboardPost[],
  filters: SocialDashboardWidget['filters'],
  /** The widget's primary group-by dimension, used to resolve `post_count`
   *  (min group size) conditions. Omit for ungrouped widgets - those no-op. */
  primaryDimension?: CustomDimension,
): DashboardPost[] {
  if (!filters) return posts;
  const working = applyPostCountConditions(posts, filters.conditions, primaryDimension);
  const themes = filters.themes?.length ? new Set(filters.themes) : null;
  const entities = filters.entities?.length ? new Set(filters.entities) : null;
  const brands = filters.brands?.length ? new Set(filters.brands) : null;

  // Custom-field constraints, split by shape: array-of-scalars fields key on the
  // field name; list[object] fields collect one selected-value Set per leaf.
  const arrayCustom = new Map<string, Set<string>>();
  const objectCustom = new Map<string, Map<string, Set<string>>>();
  for (const [key, vals] of Object.entries(filters.custom_fields ?? {})) {
    if (!vals?.length) continue;
    const dot = key.indexOf('.');
    if (dot >= 0) {
      const field = key.slice(0, dot);
      const leaf = key.slice(dot + 1);
      const m = objectCustom.get(field) ?? new Map<string, Set<string>>();
      objectCustom.set(field, m);
      m.set(leaf, new Set(vals));
    } else {
      arrayCustom.set(key, new Set(vals));
    }
  }

  if (!themes && !entities && !brands && arrayCustom.size === 0 && objectCustom.size === 0) {
    return working;
  }

  return working.map((p) => {
    let next: DashboardPost | null = null;
    const ensure = () => (next ??= { ...p });

    const pruneArr = (arr: string[] | undefined, sel: Set<string>, assign: (v: string[]) => void) => {
      if (!arr?.length) return;
      const f = arr.filter((v) => sel.has(v));
      if (f.length !== arr.length) assign(f);
    };
    if (themes) pruneArr(p.themes, themes, (v) => { ensure().themes = v; });
    if (entities) pruneArr(p.entities, entities, (v) => { ensure().entities = v; });
    if (brands) pruneArr(p.detected_brands, brands, (v) => { ensure().detected_brands = v; });

    if ((arrayCustom.size || objectCustom.size) && p.custom_fields) {
      const src = p.custom_fields;
      let cf: Record<string, unknown> | null = null;
      const ensureCf = () => (cf ??= { ...src });

      for (const [name, sel] of arrayCustom) {
        const raw = src[name];
        if (!Array.isArray(raw)) continue;
        // Only scalar arrays here; object arrays are handled by objectCustom.
        if (raw.some((e) => e && typeof e === 'object' && !Array.isArray(e))) continue;
        const f = raw.filter((v) => v != null && sel.has(String(v)));
        if (f.length !== raw.length) ensureCf()[name] = f;
      }

      for (const [field, leafMap] of objectCustom) {
        const raw = src[field];
        if (!Array.isArray(raw)) continue;
        // Keep elements matching ALL active leaf constraints on this field.
        const f = raw.filter((el) => {
          if (!el || typeof el !== 'object' || Array.isArray(el)) return false;
          for (const [leaf, sel] of leafMap) {
            const lv = (el as Record<string, unknown>)[leaf];
            if (lv == null || !sel.has(String(lv))) return false;
          }
          return true;
        });
        if (f.length !== raw.length) ensureCf()[field] = f;
      }

      if (cf) ensure().custom_fields = cf;
    }

    return next ?? p;
  });
}

function asStringArray(v: string | number | string[]): string[] {
  return Array.isArray(v) ? v : [String(v)];
}

/** Grouping keys for a condition dimension. Mirrors `getDimensionKeys` but also
 *  resolves object-leaf custom dims (`custom:men.name`), which the aggregator
 *  handles on a separate element-as-unit path. */
function conditionDimensionKeys(post: DashboardPost, dim: CustomDimension): string[] {
  if (isCustomFieldDimension(dim)) {
    const name = customFieldName(dim);
    const dot = name.indexOf('.');
    if (dot >= 0) {
      const field = name.slice(0, dot);
      const leaf = name.slice(dot + 1);
      const raw = post.custom_fields?.[field];
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((el) => el && typeof el === 'object' && !Array.isArray(el))
        .map((el) => String((el as Record<string, unknown>)[leaf]));
    }
  }
  return getDimensionKeys(post, dim, 'day');
}

function getConditionFieldValue(
  post: DashboardPost,
  field: FilterConditionField,
): string | number | string[] {
  switch (field) {
    case 'like_count': return post.like_count ?? 0;
    case 'view_count': return post.view_count ?? 0;
    case 'comment_count': return post.comment_count ?? 0;
    case 'share_count': return post.share_count ?? 0;
    case 'engagement_total': return (post.like_count ?? 0) + (post.comment_count ?? 0) + (post.share_count ?? 0);
    case 'posted_at': return post.posted_at?.slice(0, 10) ?? '';
    case 'text': return post.content ?? '';
    case 'post_count': return ''; // handled at the aggregation layer; never read here
  }
  // Categorical built-ins (sentiment, platform, themes, …) + custom:<name>:
  // reuse the aggregation grouping keys so conditions agree with the aggregator.
  return conditionDimensionKeys(post, field as CustomDimension);
}

function matchesCondition(post: DashboardPost, cond: FilterCondition): boolean {
  // Group-count conditions are a row filter on the aggregation layer; they must
  // never drop posts at the post level (or raw-post frames would be wrong).
  if (isPostCountCondition(cond)) return true;

  const { operator: op } = cond;
  const raw = getConditionFieldValue(post, cond.field);

  // Categorical multi-select (built-in categorical + custom literal/list[str]/bool).
  if (op === 'isAnyOf' || op === 'isNoneOf') {
    const sel = new Set(cond.values ?? []);
    if (sel.size === 0) return true; // half-configured → no-op
    const hit = asStringArray(raw).some((v) => sel.has(v));
    return op === 'isAnyOf' ? hit : !hit;
  }

  // Numeric comparisons: built-in numeric fields + numeric custom fields.
  if ((op === 'greaterThan' || op === 'lessThan' || op === 'equals' || op === 'between')
      && !DATE_CONDITION_FIELDS.includes(cond.field)) {
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    const cv = Number(cond.value);
    switch (op) {
      case 'greaterThan': return n > cv;
      case 'lessThan': return n < cv;
      case 'equals': return n === cv;
      case 'between': return n >= cv && n <= Number(cond.value2 ?? cv);
    }
  }

  // Date comparisons (posted_at).
  if (op === 'before' || op === 'after' || op === 'between') {
    const d = Array.isArray(raw) ? (raw[0] ?? '') : String(raw);
    switch (op) {
      case 'before': return d < String(cond.value);
      case 'after': return d > String(cond.value);
      case 'between': return d >= String(cond.value) && d <= String(cond.value2 ?? cond.value);
    }
  }

  // Text operators (post text + str custom).
  const t = (Array.isArray(raw) ? raw.join(' ') : String(raw)).toLowerCase();
  switch (op) {
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
  /** Optional callback: a media widget reports its intrinsic aspect ratio
   * (natural width / height) once the image/video loads. The grid uses it to
   * size the cell to the media's proportions on compact (mobile) breakpoints. */
  onMediaAspect?: (i: string, ratio: number) => void;
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
      showSparkline={widget.showSparkline}
      isEditMode={isEditMode}
      onConfigure={onConfigure}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
      containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}
    />
  );
}

function WordCloudWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const cloudData = useMemo(
    () => aggregateThemeCloud(applyWidgetValueFilters(posts, widget.filters, 'themes')),
    [posts, widget.filters],
  );
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
      <SocialWordCloudWidget
        data={cloudData}
        onWordClick={onFilterToggle ? (v) => onFilterToggle('themes', v) : undefined}
        scale={widget.styleOverrides?.wordCloudScale}
        seriesColors={widget.styleOverrides?.seriesColors}
        seriesLabels={widget.styleOverrides?.seriesLabels}
      />
    </SocialWidgetFrame>
  );
}

function EntityWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onFilterToggle }: FrameProps & { posts: DashboardPost[]; onFilterToggle?: (key: string, value: string) => void }) {
  const entityData = useMemo(
    () => aggregateEntities(applyWidgetValueFilters(posts, widget.filters, 'entities')),
    [posts, widget.filters],
  );
  const listData = useMemo<WidgetData>(() => ({
    labels: entityData.map((d) => d.entity),
    values: entityData.map((d) => d.mentions),
  }), [entityData]);

  if (widget.chartType === 'table') {
    // tableConfig drives the configurable design; falls back to the hardcoded
    // EntityTable only when neither the widget nor the dimension has defaults.
    const tableConfig = widget.tableConfig ?? defaultTableConfigFor('entities');
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <ConfigurableTableWidget
          posts={posts}
          filters={widget.filters}
          tableConfig={tableConfig}
          onFilterToggle={onFilterToggle}
          labelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
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
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <ConfigurableTableWidget
          posts={posts}
          filters={widget.filters}
          tableConfig={tableConfig}
          onFilterToggle={onFilterToggle}
          labelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
      <SocialProgressListWidget
        data={listData}
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
      />
    </SocialWidgetFrame>
  );
}

function CustomWidget({
  widget,
  widgetIndex = 0,
  posts,
  basePosts,
  topics,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  onTopicNavigate,
  computedFields,
}: FrameProps & {
  widgetIndex?: number;
  posts: DashboardPost[];
  /** Dashboard-scope (pre-widget-filter) posts. Baseline for the `percent`
   *  number-card aggregation. */
  basePosts?: DashboardPost[];
  topics?: TopicMetric[];
  onFilterToggle?: (key: string, value: string) => void;
  onTopicNavigate?: (clusterId: string) => void;
  computedFields?: ComputedField[];
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

  // Value-level filtering: prune multi-valued fields to the selected values so a
  // breakdown of a filtered field counts only what was selected (not the whole
  // kept post). Row filtering already scoped which posts are here.
  const aggPosts = useMemo(
    () => applyWidgetValueFilters(posts, widget.filters, config?.dimension as CustomDimension | undefined),
    [posts, widget.filters, config?.dimension],
  );

  const data = useMemo<WidgetData | null>(() => {
    if (!effectiveConfig) return null;
    // P2 server-side aggregation: a read-only host (public share with
    // `?agg=server`) injects the server-computed series for widgets the engine
    // reproduces exactly. Use it verbatim and skip the client recompute. Guarded
    // by !isEditMode (the editor must always reflect live edits) and an
    // unchanged active metric (a viewer metric-toggle recomputes locally).
    if (widget.serverData && !isEditMode && activeMetric === config?.metric) {
      return widget.serverData;
    }
    // list[object] fields aggregate element-as-unit on the posts source - check
    // before the topics branch since object tokens live inside `dataSource:posts`.
    const objField = objectFieldOf(effectiveConfig);
    if (objField) return aggregateObjectList(aggPosts, objField, effectiveConfig);
    // Heatmap renders a 2D pivot grid with cyclical-aware ordering - it has its
    // own aggregator (posts source only; topics has no breakdown/time axis).
    if (widget.chartType === 'heatmap' && !isTopicsSource) {
      return aggregateHeatmap(aggPosts, effectiveConfig, computedFields);
    }
    return isTopicsSource
      ? aggregateTopicsCustom(topics ?? [], effectiveConfig)
      : aggregateCustom(aggPosts, effectiveConfig, computedFields, basePosts);
  }, [isTopicsSource, aggPosts, topics, effectiveConfig, computedFields, basePosts, widget.chartType, widget.serverData, isEditMode, activeMetric, config?.metric]);

  const cloudData = useMemo(() => {
    if (!data?.labels || !data.values) return [];
    return data.labels.map((text, i) => ({ text, value: data.values![i] }));
  }, [data]);

  // Trendline series: re-run the SAME aggregation framework over the chosen
  // datetime X-axis dimension + bucket, so the number-card sparkline shares the
  // charts' time-series path (no bespoke per-card aggregation). Only computed
  // when the trendline is enabled.
  const sparklineData = useMemo(() => {
    if (!effectiveConfig) return [];
    if (!resolveSparklineEnabled(widget.numberSize ?? 'medium', widget.showSparkline)) return [];
    const series = aggregateCustom(aggPosts, {
      ...effectiveConfig,
      dimension: widget.trendDimension ?? 'posted_at',
      timeBucket: widget.trendTimeBucket ?? 'day',
      breakdownDimension: undefined,
    }, computedFields);
    const values = series.values ?? [];
    return widget.trendCumulative ? toCumulativeSeries(values) : values;
  }, [effectiveConfig, aggPosts, widget.numberSize, widget.showSparkline, widget.trendDimension, widget.trendTimeBucket, widget.trendCumulative, computedFields]);

  const syntheticKpi = useMemo(() => {
    const base = { label: widget.title, icon: 'posts' as const, sparklineData };
    // `mode` ("Top value") returns a string label; compose the card text from
    // the chosen pieces (label / count / percent-of-posts). Default: label only.
    if (data?.stringValue != null) {
      const parts = widget.topValueParts?.length ? widget.topValueParts : ['label'];
      const count = data.value ?? 0;
      // Percentage base = posts that have a value (missing excluded), not every
      // post in the widget.
      const total = data.valueTotal ?? 0;
      const pieces = parts.map((part) =>
        part === 'count'
          ? formatNumber(count)
          : part === 'percent'
            ? `${total > 0 ? Math.round((count / total) * 1000) / 10 : 0}%`
            : data.stringValue!,
      );
      return { ...base, value: count, displayText: pieces.join(' · ') };
    }
    return { ...base, value: data?.value ?? 0, format: data?.format };
  }, [widget.title, widget.topValueParts, data?.value, data?.stringValue, data?.valueTotal, data?.format, sparklineData]);

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
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
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
        kpiIndex={widgetIndex}
        size={widget.numberSize}
        showSparkline={widget.showSparkline}
        isEditMode={isEditMode}
        onConfigure={onConfigure}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}
      />
    );
  }

  if (widget.chartType === 'word-cloud') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <SocialWordCloudWidget
          data={cloudData}
          scale={widget.styleOverrides?.wordCloudScale}
          seriesColors={widget.styleOverrides?.seriesColors}
          seriesLabels={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'progress-list') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
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
        <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
          <ConfigurableTableWidget
            posts={posts}
            filters={widget.filters}
            topics={topics}
            dataSource={dataSource}
            tableConfig={tableConfig}
            onFilterToggle={onFilterToggle}
            onTopicNavigate={onTopicNavigate}
            labelOverrides={widget.styleOverrides?.seriesLabels}
            serverRows={!isEditMode ? (widget.serverTableRows as TableRow[] | undefined) : undefined}
            serverPostIds={!isEditMode ? widget.serverPostIds : undefined}
          />
        </SocialWidgetFrame>
      );
    }
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <GenericTableView data={data ?? undefined} labelOverrides={widget.styleOverrides?.seriesLabels} />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'heatmap') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <SocialHeatmapWidget
          data={data ?? undefined}
          accent={widget.styleOverrides?.accent ?? widget.accent}
          seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} headerAction={headerAction} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
      <SocialChartWidget
        chartType={widget.chartType}
        data={data ?? undefined}
        accent={widget.styleOverrides?.accent ?? widget.accent}
        seriesColorOverrides={widget.styleOverrides?.seriesColors}
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        barOrientation={widget.customConfig?.barOrientation}
        stacked={widget.customConfig?.stacked ?? true}
        timeBucket={widget.customConfig?.timeBucket}
        centerLabel={widget.styleOverrides?.centerLabel?.trim() || metricLabel(activeMetric)}
        labelDisplay={widget.styleOverrides?.labelDisplay}
        sliceLabelDisplay={widget.styleOverrides?.sliceLabelDisplay}
        xAxis={widget.styleOverrides?.xAxis}
        yAxis={widget.styleOverrides?.yAxis}
        axisTitleDefaults={defaultAxisTitles(effectiveConfig ?? config, widget.chartType, dataSource)}
      />
    </SocialWidgetFrame>
  );
}


function GenericChartWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  // Value-level filter: prune multi-valued fields (themes) to the selected
  // values. Scalar aggregations are unaffected - prune never drops posts.
  const aggPosts = useMemo(
    () => applyWidgetValueFilters(posts, widget.filters, widget.aggregation as CustomDimension),
    [posts, widget.filters, widget.aggregation],
  );
  const chartData = useMemo<WidgetData | null>(() => {
    switch (widget.aggregation) {
      case 'sentiment': {
        const d = aggregateSentiment(aggPosts);
        return { labels: d.map((x) => x.sentiment), values: d.map((x) => x.count) };
      }
      case 'emotion': {
        const d = aggregateEmotions(aggPosts);
        return { labels: d.map((x) => x.emotion), values: d.map((x) => x.count) };
      }
      case 'platform': {
        const d = aggregatePlatforms(aggPosts);
        return { labels: d.map((x) => x.platform), values: d.map((x) => x.post_count) };
      }
      case 'themes': {
        const d = aggregateThemes(aggPosts);
        return { labels: d.map((x) => x.theme), values: d.map((x) => x.post_count) };
      }
      case 'content-type': {
        const d = aggregateContentTypes(aggPosts);
        return { labels: d.map((x) => x.content_type), values: d.map((x) => x.count) };
      }
      case 'language': {
        const d = aggregateLanguages(aggPosts);
        return { labels: d.map((x) => x.language), values: d.map((x) => x.post_count) };
      }
      case 'engagement-rate': {
        const d = aggregateEngagementRate(aggPosts);
        return { timeSeries: d.map((x) => ({ date: x.date, value: x.rate })) };
      }
      case 'theme-cloud': {
        const d = aggregateThemeCloud(aggPosts);
        return { labels: d.map((x) => x.text), values: d.map((x) => x.value) };
      }
      default:
        return null;
    }
  }, [widget.aggregation, aggPosts]);

  if (widget.chartType === 'progress-list') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
        <SocialProgressListWidget
          data={chartData ?? undefined}
          seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
      <SocialChartWidget
        chartType={widget.chartType}
        data={chartData ?? undefined}
        accent={widget.styleOverrides?.accent ?? widget.accent}
        seriesColorOverrides={widget.styleOverrides?.seriesColors}
        seriesLabelOverrides={widget.styleOverrides?.seriesLabels}
        barOrientation={widget.customConfig?.barOrientation}
        centerLabel={widget.styleOverrides?.centerLabel?.trim() || 'Posts'}
        labelDisplay={widget.styleOverrides?.labelDisplay}
        sliceLabelDisplay={widget.styleOverrides?.sliceLabelDisplay}
        xAxis={widget.styleOverrides?.xAxis}
        yAxis={widget.styleOverrides?.yAxis}
      />
    </SocialWidgetFrame>
  );
}

// ── Text (markdown) widget ────────────────────────────────────────────────────

function TextWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize }: FrameProps) {
  const content = widget.markdownContent ?? '';
  // Container visibility: a heading-only text widget (page/section header)
  // renders frameless by default; body copy gets the boxed report card. The
  // user can override either way via the config dialog (`showContainer`).
  const boxed = widgetContainerVisible(widget);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Auto-fit the widget grid height to its rendered content. Avoids inner
  // scrollbars and large pockets of empty whitespace. Fires on mount, on
  // content change, and on container resize. Updates are debounced to a
  // single rAF to coalesce burst observer callbacks during layout flush.
  useEffect(() => {
    if (!onAutoSize || !shouldAutoSizeWidget(widget) || !contentRef.current) return;
    const ROW_HEIGHT_PX = 48;
    const MARGIN_Y_PX = 14; // keep in sync with SocialDashboardGrid MARGIN
    // Boxed cards add p-5 (40px vertical) chrome; frameless headers just need a
    // little breathing room below the last block.
    const BOTTOM_PAD_PX = autoSizeBottomPadPx(boxed);
    // Trailing debounce: a single layout shift can fire the ResizeObserver many
    // times in a row (most notably while a web font swaps in and reflows the
    // headings taller, step by step). Measuring + onAutoSize on every callback
    // turns that burst into a re-render storm that React aborts with
    // "Maximum update depth exceeded". Collapsing the burst into one measurement
    // after it settles keeps the fit correct without the storm.
    let timer = 0;
    const recompute = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!contentRef.current) return;
        const contentH = contentRef.current.scrollHeight;
        const cellPx = contentH + BOTTOM_PAD_PX;
        const targetH = Math.max(2, Math.ceil(cellPx / (ROW_HEIGHT_PX + MARGIN_Y_PX)));
        // Asymmetric dead-band: grow freely, only shrink on a >=2-row drop, so a
        // sub-pixel reflow can't oscillate the height by a single row.
        const delta = targetH - widget.h;
        if (delta >= 1 || delta <= -2) {
          onAutoSize(widget.i, targetH);
        }
      }, 120);
    };
    const observer = new ResizeObserver(recompute);
    observer.observe(contentRef.current);
    recompute();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [widget.i, widget.h, widget.manualHeight, content, boxed, onAutoSize]);

  // Boxed summaries get the design's framed report card; heading-only widgets
  // (page title, section dividers) render frameless on the page. In edit mode
  // the entire widget acts as the drag handle and a floating menu surfaces the
  // configure/remove/duplicate actions on hover.
  return (
    <div
      style={boxed ? { backgroundColor: 'var(--widget-surface)' } : undefined}
      className={`h-full relative group ${
        boxed
          ? 'rounded-[14px] border border-border shadow-[0_1px_2px_rgba(35,30,22,0.04),0_1px_1px_rgba(35,30,22,0.03)] overflow-hidden'
          : 'bg-transparent db-title'
      } ${
        isEditMode ? `drag-handle cursor-grab active:cursor-grabbing ring-1 ring-dashed ring-primary/30${boxed ? '' : ' rounded-md'}` : ''
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
        // `scrollbar-gutter: stable` reserves the scrollbar's width whether or
        // not it's shown, so a transient scrollbar (while auto-size catches up)
        // can't shrink the content width, reflow the text, and oscillate the
        // measured height. Without it, classic (non-overlay) scrollbars cause an
        // infinite grow/shrink loop in the auto-size effect above.
        <div className={cardScrollWrapperClass(boxed)}>
          {/* Inner div is the natural-height content; outer wrapper provides
              the scrolling fallback if auto-size hasn't caught up yet. The
              `ref` is placed on the inner div so scrollHeight measures the
              content, not the (possibly oversized) cell. */}
          <div ref={contentRef}>
            <Markdown
              autoDir
              stripComments={false}
              headingIds
              className="agent-prose brief-prose db-text max-w-none break-words leading-relaxed"
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

// ── HTML / Embed widget ───────────────────────────────────────────────────────
// Renders a self-contained, super-admin-authored HTML snippet (banners, CTAs,
// animated callouts). The markup is sanitized (DOMPurify - scripts/handlers/
// javascript: URLs stripped, no JS runs) and injected into a Shadow DOM so its
// CSS can't leak onto the rest of the dashboard. Like text/embed cards it
// auto-fits its grid height to the rendered content. html2canvas-pro traverses
// shadow roots, so it captures natively in the PNG/PDF export (no fallback).
function HtmlWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize }: FrameProps) {
  const content = widget.htmlContent ?? '';
  const sanitized = useMemo(() => sanitizeWidgetHtml(content), [content]);
  const boxed = widgetContainerVisible(widget);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Inject the sanitized markup into a Shadow DOM. The base `<style>` keeps
  // embedded media from overflowing the cell. Re-runs whenever the snippet
  // changes; the shadow root is attached once and its content swapped.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>:host{display:block;max-width:100%}img,video,svg,canvas{max-width:100%;height:auto}</style>' +
      sanitized;
  }, [sanitized]);

  // Auto-fit grid height to the rendered snippet (mirrors TextWidget). The host
  // element's scrollHeight reflects the laid-out shadow content. Debounced to a
  // trailing timeout so a font swap / animation reflow can't storm re-renders.
  useEffect(() => {
    if (!onAutoSize || !shouldAutoSizeWidget(widget) || !hostRef.current) return;
    const ROW_HEIGHT_PX = 48;
    const MARGIN_Y_PX = 14; // keep in sync with SocialDashboardGrid MARGIN
    const BOTTOM_PAD_PX = autoSizeBottomPadPx(boxed);
    let timer = 0;
    const recompute = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!hostRef.current) return;
        const contentH = hostRef.current.scrollHeight;
        const cellPx = contentH + BOTTOM_PAD_PX;
        const targetH = Math.max(2, Math.ceil(cellPx / (ROW_HEIGHT_PX + MARGIN_Y_PX)));
        const delta = targetH - widget.h;
        if (delta >= 1 || delta <= -2) {
          onAutoSize(widget.i, targetH);
        }
      }, 120);
    };
    const observer = new ResizeObserver(recompute);
    observer.observe(hostRef.current);
    recompute();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [widget.i, widget.h, widget.manualHeight, sanitized, boxed, onAutoSize]);

  // When the user manually sizes the widget, grid-row quantization (62 px/row)
  // makes it impossible to land on a height that exactly fits the content:
  // one row too few → scrollbar; one row too many → dead space.  Fix: zoom the
  // shadow content to fill the container height exactly so either extreme is
  // eliminated.  CSS `zoom` (layout-aware, unlike transform:scale) is reset
  // before each measurement so scrollHeight always reflects the natural height.
  useEffect(() => {
    const host = hostRef.current;
    if (!widget.manualHeight || !host) {
      if (host) { host.style.zoom = ''; host.style.width = ''; }
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let animId = 0;
    const applyZoom = () => {
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(() => {
        if (!hostRef.current || !containerRef.current) return;
        const h = hostRef.current;
        const c = containerRef.current;
        // Reset zoom so scrollHeight gives the natural (unscaled) height.
        // Reading scrollHeight after a style mutation forces a synchronous
        // layout reflow, so the value is always up-to-date.
        h.style.zoom = '';
        h.style.width = '';
        const naturalH = h.scrollHeight;
        const containerH = c.clientHeight;
        if (naturalH > 0 && containerH > 0) {
          const ratio = containerH / naturalH;
          // Only ever SHRINK (ratio < 1) to keep tall content from clipping.
          // Never enlarge: `zoom > 1` scales the rendered content but does NOT
          // widen the host's box, and the old `width:(100/zoom)%` companion
          // actively narrowed it - together they left a dead strip on the right
          // of every widget whose content already fit. When content fits we
          // leave the host at its natural 100% width (cells are sized to the
          // content, so there is no vertical gap either). `width` stays unset in
          // both branches: the broken width compensation is gone for good.
          h.style.zoom = ratio < 0.985 ? String(ratio) : '';
        }
      });
    };

    // Re-apply when the grid cell is resized (user drags the handle).
    // Observing the container (not the host) avoids a feedback loop: zoom
    // changes the host's layout size but not the container's clientHeight.
    const obs = new ResizeObserver(applyZoom);
    obs.observe(container);

    // The first measurement after an edit happens before the snippet's custom
    // fonts (Fraunces / Inter Tight) have loaded, so `naturalH` reflects the
    // fallback metrics and the computed `width:(100/zoom)%` is stale once the
    // font swaps - leaving the dead strip on the right the user reported. The
    // container ResizeObserver can't catch this (the grid cell never changes
    // size). Re-apply on font readiness, on any shadow-content mutation, and on
    // a couple of trailing ticks (covers late <img> loads that don't mutate the
    // DOM). All paths are idempotent: applyZoom resets then recomputes.
    let fontsAlive = true;
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => { if (fontsAlive) applyZoom(); });
    }
    const shadow = host.shadowRoot;
    const mo = shadow ? new MutationObserver(applyZoom) : null;
    if (shadow && mo) mo.observe(shadow, { childList: true, subtree: true, attributes: true });
    const t1 = window.setTimeout(applyZoom, 250);
    const t2 = window.setTimeout(applyZoom, 700);
    applyZoom();

    return () => {
      fontsAlive = false;
      obs.disconnect();
      mo?.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      cancelAnimationFrame(animId);
      if (hostRef.current) { hostRef.current.style.zoom = ''; hostRef.current.style.width = ''; }
    };
  }, [widget.manualHeight, sanitized]);

  // HTML widgets always clip overflow so neither a scrollbar (content too tall)
  // nor the scrollbar-gutter reservation (phantom right-side strip) appears.
  // Auto-size converges quickly; manual-size uses zoom to fill the cell exactly.
  const wrapperClass = boxed
    ? 'h-full overflow-hidden px-5 py-5'
    : 'h-full overflow-hidden';

  return (
    <div
      data-html-widget="1"
      style={boxed ? { backgroundColor: 'var(--widget-surface)' } : undefined}
      className={`h-full relative group ${
        boxed
          ? 'rounded-[14px] border border-border shadow-[0_1px_2px_rgba(35,30,22,0.04),0_1px_1px_rgba(35,30,22,0.03)] overflow-hidden'
          : 'bg-transparent'
      } ${
        isEditMode ? `drag-handle cursor-grab active:cursor-grabbing ring-1 ring-dashed ring-primary/30${boxed ? '' : ' rounded-md'}` : ''
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
        <div ref={containerRef} className={wrapperClass}>
          {/* Shadow-DOM host: natural-height block; ref measures its content. */}
          <div ref={hostRef} />
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
          Empty HTML card - click the gear to paste a snippet
        </div>
      )}
    </div>
  );
}

// ── Media widget (image / GIF / video) ───────────────────────────────────────
// Shows a single uploaded or linked image/GIF/video. Unlike text/embed cards it
// does NOT auto-size - the user sizes the frame and the media fits inside it
// (object-contain by default, object-cover to fill). GIFs render as <img>.

function MediaWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate, onMediaAspect }: FrameProps) {
  const media = widget.media;
  const reportAspect = (naturalW: number, naturalH: number) => {
    if (onMediaAspect && naturalW > 0 && naturalH > 0) {
      onMediaAspect(widget.i, naturalW / naturalH);
    }
  };
  const src = media?.uploadPath
    ? mediaServeUrl(media.uploadPath)
    : (media?.src ?? '').trim();
  const fitClass = (media?.fit ?? 'contain') === 'cover'
    ? 'w-full h-full object-cover'
    : 'max-w-full max-h-full object-contain';
  // Full-bleed body (no CardContent padding) so the media fills the card
  // edge-to-edge and is centered exactly. Keep the default padding when a figure
  // caption is shown so the caption isn't flush against the card edge.
  const fullBleed = !widget.figureText;

  return (
    <SocialWidgetFrame
      title={widget.title}
      description={widget.description}
      figureText={widget.figureText}
      isEditMode={isEditMode}
      onConfigure={onConfigure}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
      icon={widgetHeaderIcon(widget)}
      contentClassName={fullBleed ? 'p-0' : undefined}
      containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}
    >
      <div
        className={`flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden ${
          // No header exists when the title is blank, so the frame's header
          // drag-handle is absent - make the media body the drag handle in edit
          // mode so the widget stays movable.
          isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {!src ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
            Empty media card - click the gear to add an image or video
          </div>
        ) : media?.kind === 'video' ? (
          <video
            src={src}
            className={fitClass}
            controls={media?.controls ?? true}
            loop={media?.loop ?? false}
            // Browsers block autoplay unless muted, so force muted when autoplay is on.
            muted={(media?.muted ?? false) || (media?.autoplay ?? false)}
            autoPlay={media?.autoplay ?? false}
            playsInline
            onLoadedMetadata={(e) => reportAspect(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          />
        ) : (
          <img
            src={src}
            alt={media?.alt ?? ''}
            className={fitClass}
            draggable={false}
            onLoad={(e) => reportAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
        )}
      </div>
    </SocialWidgetFrame>
  );
}

// ── Embed Posts widget ────────────────────────────────────────────────────────
// Single URL → one embed; 2+ URLs → carousel. Mode is auto-derived, the user
// never picks. Uses SocialWidgetFrame for chrome and auto-size like TextWidget.

function EmbedsWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, onAutoSize }: FrameProps & { posts: DashboardPost[] }) {
  const cfg = widget.embedConfig;
  const isCollection = cfg?.source === 'collection';
  const urls = (widget.embedUrls ?? []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  // Collection mode resolves the live top-N selection from the widget's posts.
  // P2 (public share): when the server pre-resolved the ranked ids, render those
  // posts in the given order (the bounded `posts` array holds their bodies) and
  // skip the client ranking entirely.
  const collectionPosts = useMemo(() => {
    if (!isCollection) return [];
    if (widget.serverPostIds && !isEditMode) {
      const byId = new Map(posts.map((p) => [p.post_id, p]));
      return widget.serverPostIds.map((id) => byId.get(id)).filter((p): p is DashboardPost => !!p);
    }
    return resolveEmbedPosts(posts, cfg);
  }, [isCollection, posts, cfg, widget.serverPostIds, isEditMode]);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // URL mode auto-fits the card height to the embedded post(s). Collection
    // mode fills the user-sized frame (the gallery scrolls/marquees), so it
    // never auto-sizes.
    if (isCollection || !onAutoSize || !shouldAutoSizeWidget(widget) || !contentRef.current) return;
    const ROW_HEIGHT_PX = 48;
    const MARGIN_Y_PX = 14; // keep in sync with SocialDashboardGrid MARGIN
    const BOTTOM_PAD_PX = 24;
    // Trailing debounce (see TextWidget) - coalesces ResizeObserver bursts (embed
    // iframes resizing as they load) into a single measurement + update.
    let timer = 0;
    const recompute = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!contentRef.current) return;
        const contentH = contentRef.current.scrollHeight;
        const cellPx = contentH + BOTTOM_PAD_PX;
        const targetH = Math.max(4, Math.ceil(cellPx / (ROW_HEIGHT_PX + MARGIN_Y_PX)));
        // Asymmetric dead-band (see TextWidget): grow freely, only shrink on a
        // >=2-row drop, so a sub-pixel reflow can't oscillate the height.
        const delta = targetH - widget.h;
        if (delta >= 1 || delta <= -2) {
          onAutoSize(widget.i, targetH);
        }
      }, 120);
    };
    const observer = new ResizeObserver(recompute);
    observer.observe(contentRef.current);
    recompute();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [widget.i, widget.h, widget.manualHeight, urls.length, onAutoSize, isCollection]);

  const frameProps = {
    title: widget.title,
    description: widget.description,
    figureText: widget.figureText,
    isEditMode,
    onConfigure,
    onRemove,
    onDuplicate,
    icon: widgetHeaderIcon(widget),
    containerHidden: !widgetContainerVisible(widget),
    showWatermark: !!widget.showWatermark,
  };

  // Collection mode: a visual card gallery (grid or marquee) filling the frame.
  if (isCollection) {
    return (
      <SocialWidgetFrame {...frameProps}>
        <div className="flex-1 min-h-0 w-full">
          {collectionPosts.length === 0 ? (
            <div className="flex h-full items-center justify-center py-12 text-xs text-muted-foreground italic">
              {posts.length === 0
                ? 'No posts in scope - adjust the filters or global date range'
                : 'No posts match this selection - click the gear to adjust'}
            </div>
          ) : (
            <EmbedPostGallery
              posts={collectionPosts}
              display={cfg?.display ?? 'grid'}
              rankBy={cfg?.rankBy ?? DEFAULT_EMBED_RANK}
              speed={cfg?.speed}
            />
          )}
        </div>
      </SocialWidgetFrame>
    );
  }

  // URL mode: single embed, or 2+ → carousel. Auto-sizes to content.
  return (
    <SocialWidgetFrame {...frameProps}>
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

/** Expanded post row that lazy-fetches the display-only fields (ai_summary/
 *  context/media_refs) the slim payload omits, on expand. Falls back to the
 *  row's own values when present (full payload / non-slim). */
function LazyExpandedPostRow({ row }: { row: PostTableRow }) {
  const { get } = usePostDetails(row.post_id ? [row.post_id] : []);
  const d = row.post_id ? get(row.post_id) : undefined;
  const merged = d
    ? {
        ...row,
        ai_summary: row.ai_summary ?? d.ai_summary,
        context: row.context ?? d.context,
        media_refs: row.media_refs ?? d.media_refs ?? undefined,
      }
    : row;
  return <ExpandedPostRow row={merged} />;
}

const POST_TABLE_COLUMNS = postColumns<PostTableRow>({ summaryField: 'content', summaryLabel: 'Content', showEntities: false });

function PostsTableWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  const rows = useMemo(() => toPostTableRows(posts), [posts]);
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} figureText={widget.figureText} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate} icon={widgetHeaderIcon(widget)} containerHidden={!widgetContainerVisible(widget)} showWatermark={!!widget.showWatermark}>
      <DataTable
        data={rows}
        columns={POST_TABLE_COLUMNS}
        getRowKey={(r) => r.post_id}
        defaultSortKey="views"
        defaultSortDir="desc"
        pageSize={25}
        renderExpandedRow={(row) => <LazyExpandedPostRow row={row} />}
        emptyMessage="No posts to display"
      />
    </SocialWidgetFrame>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────────

interface SocialWidgetRendererProps {
  widget: SocialDashboardWidget;
  /** Position of this widget in the layout. Used to vary the default accent of
   *  custom number-cards so a row of KPIs reads as distinct colors (matching the
   *  design) instead of all rendering in the first palette hue. */
  widgetIndex?: number;
  /** Already globally filtered posts */
  filteredPosts: DashboardPost[];
  /** Already globally filtered COMMENT rows (post-shaped, from scope_comments).
   *  Optional - only `dataSource: comments/both` widgets read this; empty/absent
   *  when the agent has no enriched comments. */
  filteredComments?: DashboardPost[];
  /** Agent-scoped topic_metrics rows. Optional - widgets with
   *  `dataSource: 'posts'` ignore this. Empty array when no agent context. */
  topics?: TopicMetric[];
  isEditMode: boolean;
  /** Id-taking callbacks (bound to this widget internally). Keeping them
   *  id-taking lets the grid pass its stable parent handlers straight through,
   *  so this component can be `memo`'d and skip re-render on breakpoint /
   *  resize churn that doesn't touch its own props. */
  onConfigure: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onFilterToggle?: (key: string, value: string) => void;
  /** Called when a topic widget item is clicked. Undefined disables
   *  click-through (e.g. on public/shared dashboards). */
  onTopicNavigate?: (clusterId: string) => void;
  serverKpis?: DashboardKpis;
  onAutoSize?: (i: string, h: number) => void;
  onMediaAspect?: (i: string, ratio: number) => void;
  /** Report-level value colors (field → value → hex). Flattened and merged in
   *  as the base series-color layer; per-widget `seriesColors` win. */
  reportValueColors?: Record<string, Record<string, string>>;
  /** Report-level computed fields. Needed to aggregate `expr` computed metrics
   *  (aggregate-then-evaluate). */
  reportComputedFields?: ComputedField[];
}

function SocialWidgetRendererImpl({
  widget: rawWidget,
  widgetIndex = 0,
  filteredPosts,
  filteredComments,
  topics,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  onTopicNavigate,
  serverKpis,
  onAutoSize,
  onMediaAspect,
  reportValueColors,
  reportComputedFields,
}: SocialWidgetRendererProps) {
  // Legacy aggregations (`volume`, `sentiment-over-time`) are rewritten to
  // `aggregation: 'custom'` here so the dispatch below stays uniform.
  // Topic widgets are always custom - coerce here so any stale config
  // (e.g. an agent-emitted layout that set `aggregation: 'kpi'`) routes
  // through the custom path which knows how to read topic data.
  const widget = useMemo(() => {
    let normalized = normalizeWidgetAggregation(rawWidget);
    // Bake report-level value colors in as the BASE series-color layer so any
    // downstream `widget.styleOverrides.seriesColors` read inherits them; a
    // per-widget override on the same value wins (spread last).
    if (reportValueColors) {
      const flat: Record<string, string> = {};
      for (const perField of Object.values(reportValueColors)) Object.assign(flat, perField);
      if (Object.keys(flat).length > 0) {
        normalized = {
          ...normalized,
          styleOverrides: {
            ...normalized.styleOverrides,
            seriesColors: { ...flat, ...(normalized.styleOverrides?.seriesColors ?? {}) },
          },
        };
      }
    }
    if (
      (normalized.dataSource ?? 'posts') === 'topics'
      && normalized.aggregation !== 'text'
      && normalized.aggregation !== 'embeds'
      && normalized.aggregation !== 'media'
    ) {
      return { ...normalized, aggregation: 'custom' as const };
    }
    return normalized;
  }, [rawWidget, reportValueColors]);

  // Pick the widget's data source. Comments are post-shaped, so the selected
  // array flows through every sub-widget (custom/kpi/channels/…) unchanged -
  // one substitution here is the whole comment-source wiring. Topics are NOT
  // selected here (they ride a separate `topics` prop + vocabulary).
  const sourceRows = useMemo(() => {
    const ds = widget.dataSource ?? 'posts';
    const comments = filteredComments ?? [];
    if (ds === 'comments') return comments;
    if (ds === 'both') return comments.length ? [...filteredPosts, ...comments] : filteredPosts;
    return filteredPosts;
  }, [widget.dataSource, filteredPosts, filteredComments]);

  const widgetPosts = useMemo(
    () => applyWidgetFilters(sourceRows, widget.filters),
    [sourceRows, widget.filters],
  );

  // Bind the id-taking grid handlers to this widget once. Stable identities so
  // the frame/sub-components don't see a new callback every render.
  const handleConfigure = useCallback(() => onConfigure(widget.i), [onConfigure, widget.i]);
  const handleRemove = useCallback(() => onRemove(widget.i), [onRemove, widget.i]);
  const handleDuplicate = useMemo(
    () => (onDuplicate ? () => onDuplicate(widget.i) : undefined),
    [onDuplicate, widget.i],
  );

  const frameProps = { widget, isEditMode, onConfigure: handleConfigure, onRemove: handleRemove, onDuplicate: handleDuplicate, onAutoSize, onMediaAspect };

  if (widget.aggregation === 'text') {
    return <TextWidget {...frameProps} />;
  }
  if (widget.aggregation === 'embeds') {
    return <EmbedsWidget {...frameProps} posts={widgetPosts} />;
  }
  if (widget.aggregation === 'media') {
    return <MediaWidget {...frameProps} />;
  }
  if (widget.aggregation === 'html') {
    return <HtmlWidget {...frameProps} />;
  }
  if (widget.aggregation === 'posts') {
    return <PostsTableWidget {...frameProps} posts={widgetPosts} />;
  }
  if (widget.aggregation === 'custom') {
    return (
      <CustomWidget
        {...frameProps}
        widgetIndex={widgetIndex}
        posts={widgetPosts}
        basePosts={sourceRows}
        topics={topics}
        onFilterToggle={onFilterToggle}
        onTopicNavigate={onTopicNavigate}
        computedFields={reportComputedFields}
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

// Memoized: a breakpoint switch or resize re-renders the grid but does not
// change any individual widget's props (filteredPosts, widget and all callbacks
// are referentially stable), so each widget — and its Chart.js canvas — skips
// the re-render entirely. This is the main win for the slow desktop⇄mobile and
// refresh transitions.
export const SocialWidgetRenderer = memo(SocialWidgetRendererImpl);
