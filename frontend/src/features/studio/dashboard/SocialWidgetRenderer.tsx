import { useMemo } from 'react';
import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { SocialDashboardWidget, WidgetData, FilterCondition, FilterConditionField } from './types-social-dashboard.ts';
import { NUMERIC_CONDITION_FIELDS, DATE_CONDITION_FIELDS } from './types-social-dashboard.ts';
import { aggregateCustom } from './dashboard-aggregations.ts';
import {
  aggregateSentiment,
  aggregateEmotions,
  aggregatePlatforms,
  aggregateVolume,
  aggregateSentimentOverTime,
  aggregateThemeCloud,
  aggregateThemes,
  aggregateEntities,
  aggregateChannels,
  aggregateContentTypes,
  aggregateLanguages,
  aggregateEngagementRate,
  computeEnhancedKpis,
} from './dashboard-aggregations.ts';
import { SocialChartWidget } from './SocialChartWidget.tsx';
import { SocialKpiCard } from './SocialKpiCard.tsx';
import { SocialProgressListWidget } from './SocialProgressListWidget.tsx';
import { EntityTableWidget, ChannelTableWidget } from './SocialTableWidget.tsx';
import { SocialWordCloudWidget } from './SocialWordCloudWidget.tsx';
import { SocialWidgetFrame } from './SocialWidgetFrame.tsx';
import { DataTable } from '../../../components/DataTable/DataTable.tsx';
import { postColumns } from '../../../components/DataTable/columns.tsx';
import { ExpandedPostRow } from '../../../components/DataTable/ExpandedPostRow.tsx';
import { Markdown } from '../../../components/Markdown.tsx';

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
}

// ── Sub-components (each calls hooks unconditionally) ─────────────────────────

function KpiWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate, serverKpis }: FrameProps & { posts: DashboardPost[]; serverKpis?: DashboardKpis }) {
  const kpis = useMemo(() => computeEnhancedKpis(posts, serverKpis), [posts, serverKpis]);
  const kpi = kpis[widget.kpiIndex ?? 0];
  return (
    <SocialKpiCard
      kpi={kpi}
      accent={widget.accent}
      kpiIndex={widget.kpiIndex ?? 0}
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
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
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
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <EntityTableWidget
          data={entityData}
          onRowClick={onFilterToggle ? (v) => onFilterToggle('entities', v) : undefined}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
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
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <ChannelTableWidget
          data={channelData}
          onRowClick={onFilterToggle ? (v) => onFilterToggle('channels', v) : undefined}
        />
      </SocialWidgetFrame>
    );
  }
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialProgressListWidget data={listData} />
    </SocialWidgetFrame>
  );
}

function CustomWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  const config = widget.customConfig;
  const data = useMemo<WidgetData | null>(() => {
    if (!config) return null;
    return aggregateCustom(posts, config);
  }, [posts, config]);

  const cloudData = useMemo(() => {
    if (!data?.labels || !data.values) return [];
    return data.labels.map((text, i) => ({ text, value: data.values![i] }));
  }, [data]);

  const syntheticKpi = useMemo(
    () => ({ label: widget.title, value: data?.value ?? 0, icon: 'posts' as const, sparklineData: [] }),
    [widget.title, data?.value],
  );

  if (!config) {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
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
        accent={widget.accent}
        isEditMode={isEditMode}
        onConfigure={onConfigure}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
      />
    );
  }

  if (widget.chartType === 'word-cloud') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <SocialWordCloudWidget data={cloudData} />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'progress-list') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <SocialProgressListWidget data={data ?? undefined} />
      </SocialWidgetFrame>
    );
  }

  if (widget.chartType === 'table') {
    return (
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <GenericTableView data={data ?? undefined} />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialChartWidget chartType={widget.chartType} data={data ?? undefined} accent={widget.accent} barOrientation={widget.customConfig?.barOrientation} />
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
      case 'volume': {
        const d = aggregateVolume(posts);
        const grouped: Record<string, Array<{ date: string; value: number }>> = {};
        for (const point of d) {
          if (!grouped[point.platform]) grouped[point.platform] = [];
          grouped[point.platform].push({ date: point.post_date, value: point.post_count });
        }
        return { groupedTimeSeries: grouped };
      }
      case 'sentiment-over-time': {
        const d = aggregateSentimentOverTime(posts);
        const grouped: Record<string, Array<{ date: string; value: number }>> = {
          positive: [], negative: [], neutral: [], mixed: [],
        };
        for (const point of d) {
          grouped.positive.push({ date: point.date, value: point.positive });
          grouped.negative.push({ date: point.date, value: point.negative });
          grouped.neutral.push({ date: point.date, value: point.neutral });
          grouped.mixed.push({ date: point.date, value: point.mixed });
        }
        for (const key of Object.keys(grouped)) {
          if (grouped[key].every((p) => p.value === 0)) delete grouped[key];
        }
        return { groupedTimeSeries: grouped };
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
      <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
        <SocialProgressListWidget data={chartData ?? undefined} />
      </SocialWidgetFrame>
    );
  }

  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      <SocialChartWidget chartType={widget.chartType} data={chartData ?? undefined} accent={widget.accent} barOrientation={widget.customConfig?.barOrientation} />
    </SocialWidgetFrame>
  );
}

// ── Text (markdown) widget ────────────────────────────────────────────────────

function TextWidget({ widget, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps) {
  const content = widget.markdownContent ?? '';
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
      {content.trim() ? (
        <Markdown
          autoDir
          stripComments={false}
          className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-primary overflow-y-auto h-full"
        >
          {content}
        </Markdown>
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
          Empty text card — click the gear to add markdown
        </div>
      )}
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
  is_related_to_task?: boolean | null;
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
    is_related_to_task: p.is_related_to_task,
    detected_brands: p.detected_brands,
    channel_type: p.channel_type,
    media_refs: p.media_refs,
  }));
}

const POST_TABLE_COLUMNS = postColumns<PostTableRow>({ summaryField: 'content', summaryLabel: 'Content', showEntities: false });

function PostsTableWidget({ widget, posts, isEditMode, onConfigure, onRemove, onDuplicate }: FrameProps & { posts: DashboardPost[] }) {
  const rows = useMemo(() => toPostTableRows(posts), [posts]);
  return (
    <SocialWidgetFrame title={widget.title} description={widget.description} isEditMode={isEditMode} onConfigure={onConfigure} onRemove={onRemove} onDuplicate={onDuplicate}>
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
}

export function SocialWidgetRenderer({
  widget,
  filteredPosts,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  serverKpis,
}: SocialWidgetRendererProps) {
  const widgetPosts = useMemo(
    () => applyWidgetFilters(filteredPosts, widget.filters),
    [filteredPosts, widget.filters],
  );

  const frameProps = { widget, isEditMode, onConfigure, onRemove, onDuplicate };

  if (widget.aggregation === 'text') {
    return <TextWidget {...frameProps} />;
  }
  if (widget.aggregation === 'posts') {
    return <PostsTableWidget {...frameProps} posts={widgetPosts} />;
  }
  if (widget.aggregation === 'custom') {
    return <CustomWidget {...frameProps} posts={widgetPosts} />;
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
