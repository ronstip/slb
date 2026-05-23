// ─── Core enums ──────────────────────────────────────────────────────────────

/** Which BigQuery source a widget reads from. `posts` (default) = post-level
 *  rows from `scope_posts`. `topics` = topic cluster rows from `topic_metrics`
 *  (one row per cluster in the agent's latest clustering run). */
export type DataSource = 'posts' | 'topics';

export const DEFAULT_DATA_SOURCE: DataSource = 'posts';

export type DashboardOrientation = 'horizontal' | 'vertical';

export const DEFAULT_DASHBOARD_ORIENTATION: DashboardOrientation = 'horizontal';

export type SocialAggregation =
  | 'kpi'
  | 'sentiment'
  | 'emotion'
  | 'platform'
  | 'volume'
  | 'sentiment-over-time'
  | 'theme-cloud'
  | 'themes'
  | 'entities'
  | 'channels'
  | 'content-type'
  | 'language'
  | 'engagement-rate'
  | 'posts'
  | 'custom'
  | 'text';

export type SocialChartType =
  | 'bar'
  | 'pie'
  | 'doughnut'
  | 'line'
  | 'word-cloud'
  | 'table'
  | 'number-card'
  | 'progress-list'
  | 'data-table';

// ─── Custom chart config (used when aggregation === 'custom') ─────────────────

/**
 * Group-by dimension for custom widgets. Standard fields map to columns on
 * `DashboardPost`; `brands` maps to `detected_brands`; `custom:<name>` reads
 * `post.custom_fields[name]` (scalar or array).
 */
export type CustomDimension =
  | 'platform'
  | 'sentiment'
  | 'emotion'
  | 'language'
  | 'content_type'
  | 'channel_type'
  | 'channel_handle'
  | 'posted_at'
  | 'themes'
  | 'entities'
  | 'brands'
  | `custom:${string}`;

export type StandardCustomDimension = Exclude<CustomDimension, `custom:${string}`>;

/** Prefix used to namespace agent-defined enrichment fields as group-by dimensions. */
export const CUSTOM_DIM_PREFIX = 'custom:';

export function isCustomFieldDimension(
  dim: CustomDimension | undefined | null,
): dim is `custom:${string}` {
  return typeof dim === 'string' && dim.startsWith(CUSTOM_DIM_PREFIX);
}

export function customFieldName(dim: `custom:${string}`): string {
  return dim.slice(CUSTOM_DIM_PREFIX.length);
}

const UNKNOWN_DIMENSION_META: DimensionMeta = {
  label: 'Unknown',
  icon: 'HelpCircle',
  description: 'Dimension is missing or unrecognized',
};

function humanizeFieldName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DimensionMeta {
  label: string;
  icon: string;
  description: string;
}

export function getDimensionMeta(dim: CustomDimension | undefined | null): DimensionMeta {
  if (!dim) return UNKNOWN_DIMENSION_META;
  if (isCustomFieldDimension(dim)) {
    const name = customFieldName(dim);
    return {
      label: humanizeFieldName(name),
      icon: 'Sparkles',
      description: `Group by custom enrichment field "${name}"`,
    };
  }
  return DIMENSION_META[dim] ?? UNKNOWN_DIMENSION_META;
}

export type CustomMetric =
  | 'post_count'
  | 'like_count'
  | 'view_count'
  | 'comment_count'
  | 'share_count'
  | 'engagement_total';

// ─── Topic dimensions & metrics (used when widget.dataSource === 'topics') ─────

/** Group-by dimension for topic widgets. `topic` groups by cluster header (1
 *  row per cluster). The JSON-unnested dims expand each topic's breakdown
 *  arrays (platforms_breakdown, themes_counts, ...) into rows. */
export type TopicDimension =
  | 'topic'
  | 'beat_type'
  | 'top_content_type'
  | 'top_emotion'
  | 'platform'
  | 'theme'
  | 'entity'
  | 'brand'
  | 'channel_type'
  | 'emotion';

/** Metric for topic widgets. `topic_count` is 1-per-row (count of topics).
 *  Ratio metrics (signal_score, sov_*, net_sentiment, avg_engagement_per_post,
 *  recency_score) default to `avg` aggregation; sum is not meaningful. */
export type TopicMetric =
  | 'topic_count'
  | 'post_count'
  | 'total_views'
  | 'total_likes'
  | 'total_engagement'
  | 'avg_engagement_per_post'
  | 'signal_score'
  | 'recency_score'
  | 'net_sentiment'
  | 'sov_posts'
  | 'sov_views'
  | 'sov_engagement'
  | 'estimated_post_count'
  | 'estimated_views'
  | 'unique_channels';

/** Widened union for CustomChartConfig — the runtime branches on
 *  widget.dataSource to decide which dimension/metric vocabulary applies. */
export type AnyDimension = CustomDimension | TopicDimension;
export type AnyMetric = CustomMetric | TopicMetric;

export const TOPIC_DIMENSION_META: Record<TopicDimension, DimensionMeta> = {
  topic:            { label: 'Topic',         icon: 'Sparkles',     description: 'Group by topic cluster (one row per topic)' },
  beat_type:        { label: 'Beat Type',     icon: 'Newspaper',    description: 'Group by topic beat classification' },
  top_content_type: { label: 'Content Type',  icon: 'LayoutGrid',   description: 'Group by the topic’s dominant content type' },
  top_emotion:      { label: 'Top Emotion',   icon: 'Smile',        description: 'Group by the topic’s dominant emotion' },
  platform:         { label: 'Platform',      icon: 'Globe',        description: 'Group by platform across topic platforms_breakdown' },
  theme:            { label: 'Theme',         icon: 'Tag',          description: 'Group by theme across topic themes_counts' },
  entity:           { label: 'Entity',        icon: 'Users',        description: 'Group by entity across topic entities_counts' },
  brand:            { label: 'Brand',         icon: 'Sparkles',     description: 'Group by brand across topic detected_brands_counts' },
  channel_type:     { label: 'Channel Type',  icon: 'Radio',        description: 'Group by channel type across topic channel_type_counts' },
  emotion:          { label: 'Emotion',       icon: 'Smile',        description: 'Group by emotion across topic emotion_counts' },
};

/** Topic dimensions whose values come from per-topic JSON breakdown arrays.
 *  Aggregations unnest the array and accumulate weights per (topic, entry). */
export const TOPIC_JSON_UNNESTED_DIMENSIONS: ReadonlySet<TopicDimension> = new Set<TopicDimension>([
  'platform', 'theme', 'entity', 'brand', 'channel_type', 'emotion',
]);

/** Metrics whose value is a per-topic ratio. Sum is not meaningful — these
 *  default to `avg` aggregation and are blocked from JSON-unnested dims (since
 *  they can't decompose per breakdown entry). */
export const TOPIC_RATIO_METRICS: ReadonlySet<TopicMetric> = new Set<TopicMetric>([
  'signal_score', 'recency_score', 'net_sentiment',
  'sov_posts', 'sov_views', 'sov_engagement',
  'avg_engagement_per_post',
]);

export const TOPIC_METRIC_META: Record<TopicMetric, { label: string; description: string; supportsAvg: boolean }> = {
  topic_count:             { label: 'Topic Count',          description: 'Number of topics',                                     supportsAvg: false },
  post_count:              { label: 'Posts',                description: 'Posts per topic (pre-aggregated)',                     supportsAvg: true },
  total_views:             { label: 'Views',                description: 'Total views per topic',                                supportsAvg: true },
  total_likes:             { label: 'Likes',                description: 'Total likes per topic',                                supportsAvg: true },
  total_engagement:        { label: 'Engagement',           description: 'Likes + comments + shares + saves per topic',         supportsAvg: true },
  avg_engagement_per_post: { label: 'Avg Engagement/Post',  description: 'Engagement ÷ post_count per topic',              supportsAvg: false },
  signal_score:            { label: 'Signal Score',         description: 'recency + log(views) + log(post_count) composite',     supportsAvg: false },
  recency_score:           { label: 'Recency Score',        description: 'How recent the topic’s posts are',               supportsAvg: false },
  net_sentiment:           { label: 'Net Sentiment',        description: '(positive − negative) ÷ total per topic',   supportsAvg: false },
  sov_posts:               { label: 'SOV (Posts)',          description: 'Share of voice by post volume within the run',         supportsAvg: false },
  sov_views:               { label: 'SOV (Views)',          description: 'Share of voice by views within the run',               supportsAvg: false },
  sov_engagement:          { label: 'SOV (Engagement)',     description: 'Share of voice by engagement within the run',          supportsAvg: false },
  estimated_post_count:    { label: 'Est. Posts',           description: 'Post-stratified post-count estimate',                  supportsAvg: true },
  estimated_views:         { label: 'Est. Views',           description: 'Post-stratified view estimate',                        supportsAvg: true },
  unique_channels:         { label: 'Unique Channels',      description: 'Distinct channels in the topic',                       supportsAvg: true },
};

/** Default metricAgg for a topic metric. Ratios default to avg; counts to sum. */
export function defaultTopicMetricAgg(
  metric: TopicMetric,
): 'sum' | 'avg' | 'min' | 'max' | 'count' {
  if (metric === 'topic_count') return 'count';
  return TOPIC_RATIO_METRICS.has(metric) ? 'avg' : 'sum';
}

export function getTopicDimensionMeta(
  dim: TopicDimension | undefined | null,
): DimensionMeta {
  if (!dim) return UNKNOWN_DIMENSION_META;
  return TOPIC_DIMENSION_META[dim] ?? UNKNOWN_DIMENSION_META;
}

export interface CustomChartConfig {
  /** What to group by. undefined = no groupBy → number-card.
   *  Vocabulary depends on the widget's `dataSource`:
   *  - `'posts'` (default): values are {@link CustomDimension}.
   *  - `'topics'`: values are {@link TopicDimension}. */
  dimension?: AnyDimension;
  /** Vocabulary depends on `dataSource` — see `dimension`. */
  metric: AnyMetric;
  /** default 'sum' */
  metricAgg?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  /** only applies when dimension === 'posted_at' */
  timeBucket?: 'hour' | 'day' | 'week' | 'month';
  /** Bar orientation — default 'horizontal' */
  barOrientation?: 'horizontal' | 'vertical';
  /** Optional second dimension to split bars/slices into sub-groups. For topic
   *  widgets, phase 1 ignores this (no breakdown support). */
  breakdownDimension?: AnyDimension;
  /** Max number of primary categories to show. Undefined = show all (capped at 50). */
  topN?: number;
  /** Roll remaining categories beyond topN into an "Others" bucket. Only meaningful
   *  for categorical primary dimensions (not time series). */
  includeOthers?: boolean;
  /** Bar chart stacking when a breakdownDimension is set. Default true. */
  stacked?: boolean;
  /** When set with 2+ metrics, the widget renders a header toggle so the
   *  viewer can swap the active metric without entering edit mode. The
   *  primary `metric` field is the initial selection; the toggle list should
   *  contain it. */
  metricToggle?: AnyMetric[];
}

export const DIMENSION_META: Record<StandardCustomDimension, DimensionMeta> = {
  platform:       { label: 'Platform',      icon: 'Globe',         description: 'Group by social platform' },
  sentiment:      { label: 'Sentiment',     icon: 'Heart',         description: 'Group by sentiment label' },
  emotion:        { label: 'Emotion',       icon: 'Smile',         description: 'Group by emotional tone' },
  language:       { label: 'Language',      icon: 'MessageSquare', description: 'Group by post language' },
  content_type:   { label: 'Content Type',  icon: 'LayoutGrid',    description: 'Group by content format' },
  channel_type:   { label: 'Channel Type',  icon: 'Radio',         description: 'Group by channel type (e.g. news, influencer, brand)' },
  channel_handle: { label: 'Channel',       icon: 'Tv',            description: 'Group by source channel' },
  posted_at:      { label: 'Date',          icon: 'Calendar',      description: 'Group by date over time' },
  themes:         { label: 'Theme',         icon: 'Tag',           description: 'Group by topic / theme' },
  entities:       { label: 'Entity',        icon: 'Users',         description: 'Group by mentioned entity' },
  brands:         { label: 'Brand',         icon: 'Sparkles',      description: 'Group by detected brand' },
};

export const METRIC_META: Record<CustomMetric, { label: string; description: string; supportsAvg: boolean }> = {
  post_count:       { label: 'Post Count',        description: 'Number of posts',            supportsAvg: false },
  like_count:       { label: 'Likes',             description: 'Total / avg likes',          supportsAvg: true },
  view_count:       { label: 'Views',             description: 'Total / avg views',          supportsAvg: true },
  comment_count:    { label: 'Comments',          description: 'Total / avg comments',       supportsAvg: true },
  share_count:      { label: 'Shares',            description: 'Total / avg shares',         supportsAvg: true },
  engagement_total: { label: 'Total Engagement',  description: 'Likes + comments + shares',  supportsAvg: true },
};

const ALL_CHART_TYPES: SocialChartType[] = [
  'number-card', 'bar', 'line', 'pie', 'doughnut', 'progress-list', 'word-cloud', 'table', 'data-table',
];

export function getValidChartTypesForCustom(
  _dimension: CustomDimension | undefined,
  _metric: CustomMetric,
): SocialChartType[] {
  return ALL_CHART_TYPES;
}

/** Convert a preset widget config to an equivalent CustomChartConfig for the dialog */
export function presetToCustomConfig(
  aggregation: SocialAggregation,
  kpiIndex?: number,
): { customConfig: CustomChartConfig; chartType: SocialChartType } {
  const kpiMetrics: CustomMetric[] = ['post_count', 'view_count', 'engagement_total', 'like_count', 'share_count'];
  switch (aggregation) {
    case 'kpi':
      return { customConfig: { metric: kpiMetrics[kpiIndex ?? 0] ?? 'post_count' }, chartType: 'number-card' };
    case 'sentiment':
      return { customConfig: { dimension: 'sentiment', metric: 'post_count' }, chartType: 'doughnut' };
    case 'emotion':
      return { customConfig: { dimension: 'emotion', metric: 'post_count' }, chartType: 'bar' };
    case 'platform':
      return { customConfig: { dimension: 'platform', metric: 'post_count' }, chartType: 'bar' };
    case 'language':
      return { customConfig: { dimension: 'language', metric: 'post_count' }, chartType: 'pie' };
    case 'content-type':
      return { customConfig: { dimension: 'content_type', metric: 'post_count' }, chartType: 'doughnut' };
    case 'themes':
      return { customConfig: { dimension: 'themes', metric: 'post_count' }, chartType: 'bar' };
    case 'theme-cloud':
      return { customConfig: { dimension: 'themes', metric: 'post_count' }, chartType: 'word-cloud' };
    case 'entities':
      return { customConfig: { dimension: 'entities', metric: 'post_count' }, chartType: 'bar' };
    case 'channels':
      return { customConfig: { dimension: 'channel_handle', metric: 'post_count' }, chartType: 'bar' };
    case 'volume':
      return {
        customConfig: { dimension: 'posted_at', metric: 'post_count', timeBucket: 'day', breakdownDimension: 'platform' },
        chartType: 'line',
      };
    case 'sentiment-over-time':
      return {
        customConfig: { dimension: 'posted_at', metric: 'post_count', timeBucket: 'day', breakdownDimension: 'sentiment' },
        chartType: 'line',
      };
    case 'engagement-rate':
      return { customConfig: { dimension: 'posted_at', metric: 'engagement_total', timeBucket: 'day' }, chartType: 'line' };
    case 'posts':
      return { customConfig: { metric: 'post_count' }, chartType: 'data-table' };
    default:
      return { customConfig: { metric: 'post_count' }, chartType: 'bar' };
  }
}

// ─── Table widget config (used when chartType === 'table') ─────────────────

export type TableColumnAgg = 'sum' | 'avg' | 'min' | 'max' | 'count';
/** How a dimension column summarizes multiple values within a row's group.
 *  - 'top' (default): the most frequent value as a string.
 *  - 'distinct_count': count of distinct values as a number. */
export type TableDimensionAgg = 'top' | 'distinct_count';

/** In-cell visualization for numeric columns. 'none' (default) shows raw value;
 *  'bar' adds an inline horizontal bar scaled to the column max; 'heatmap'
 *  shades the cell background by value. Ignored for string dimension cells. */
export type TableColumnViz = 'none' | 'bar' | 'heatmap';

/** Numeric format for a column. 'abs' (default) = raw number; 'pct' = the
 *  cell's share of the column's total across visible rows; 'abs_pct' = both,
 *  e.g. "1,234 (12.3%)". Ignored for string dimension cells. */
export type TableColumnDisplay = 'abs' | 'pct' | 'abs_pct';

/** Post-level field — used when `CustomTableConfig.mode === 'post'`. One row per
 *  post, each column reads a raw field off `DashboardPost`. `custom:<name>` reads
 *  `post.custom_fields[name]`. */
export type PostField =
  | 'post_url'
  | 'posted_at'
  | 'platform'
  | 'channel_handle'
  | 'channel_type'
  | 'title'
  | 'content'
  | 'ai_summary'
  | 'language'
  | 'content_type'
  | 'sentiment'
  | 'emotion'
  | 'themes'
  | 'entities'
  | 'brands'
  | 'like_count'
  | 'view_count'
  | 'comment_count'
  | 'share_count'
  | 'engagement_total'
  | `custom:${string}`;

export type StandardPostField = Exclude<PostField, `custom:${string}`>;

export function isCustomPostField(field: PostField | undefined | null): field is `custom:${string}` {
  return typeof field === 'string' && field.startsWith(CUSTOM_DIM_PREFIX);
}

/** How a post-field cell renders. Drives the column builder in
 *  SocialWidgetRenderer; keeps rendering decisions out of config. */
export type PostFieldRender =
  | 'link'      // ExternalLinkCell
  | 'date'      // TimeAgoCell
  | 'platform'  // PlatformCell
  | 'handle'    // HandleCell
  | 'content'   // ContentPreview
  | 'sentiment' // SentimentBadge
  | 'badge'     // generic small badge (emotion, language, content_type)
  | 'array'     // chip list (themes/entities/brands/custom array)
  | 'numeric'   // numeric — supports viz/display
  | 'text';     // plain string fallback

export interface PostFieldMeta {
  label: string;
  render: PostFieldRender;
}

export const POST_FIELD_META: Record<StandardPostField, PostFieldMeta> = {
  post_url:         { label: 'Link',         render: 'link' },
  posted_at:        { label: 'Posted',       render: 'date' },
  platform:         { label: 'Platform',     render: 'platform' },
  channel_handle:   { label: 'Handle',       render: 'handle' },
  channel_type:     { label: 'Channel Type', render: 'badge' },
  title:            { label: 'Title',        render: 'content' },
  content:          { label: 'Content',      render: 'content' },
  ai_summary:       { label: 'AI Summary',   render: 'content' },
  language:         { label: 'Language',     render: 'badge' },
  content_type:     { label: 'Content Type', render: 'badge' },
  sentiment:        { label: 'Sentiment',    render: 'sentiment' },
  emotion:          { label: 'Emotion',      render: 'badge' },
  themes:           { label: 'Themes',       render: 'array' },
  entities:         { label: 'Entities',     render: 'array' },
  brands:           { label: 'Brands',       render: 'array' },
  like_count:       { label: 'Likes',        render: 'numeric' },
  view_count:       { label: 'Views',        render: 'numeric' },
  comment_count:    { label: 'Comments',     render: 'numeric' },
  share_count:      { label: 'Shares',       render: 'numeric' },
  engagement_total: { label: 'Engagement',   render: 'numeric' },
};

const UNKNOWN_POST_FIELD_META: PostFieldMeta = { label: 'Unknown', render: 'text' };

export function getPostFieldMeta(field: PostField | undefined | null): PostFieldMeta {
  if (!field) return UNKNOWN_POST_FIELD_META;
  if (isCustomPostField(field)) {
    return { label: humanizeFieldName(customFieldName(field)), render: 'text' };
  }
  return POST_FIELD_META[field] ?? UNKNOWN_POST_FIELD_META;
}

export interface TableColumn {
  /** Stable key — also used as the sort key. */
  id: string;
  /** 'metric' (default — back-compat) | 'dimension' | 'post-field' (post mode). */
  kind?: 'metric' | 'dimension' | 'post-field';
  /** Metric column: which field to aggregate. Vocabulary depends on the
   *  widget's `dataSource` (see {@link CustomChartConfig}). */
  metric?: AnyMetric;
  /** Metric column: default 'sum'. Forced to 'count' for `post_count`. */
  agg?: TableColumnAgg;
  /** Dimension column: which dimension to extract. Vocabulary depends on
   *  `dataSource`. */
  dimension?: AnyDimension;
  /** Dimension column: default 'top'. */
  dimensionAgg?: TableDimensionAgg;
  /** Post-field column: which raw post field to read. Post mode only. */
  postField?: PostField;
  /** Optional header override. Falls back to `autoColumnHeader(col)`. */
  header?: string;
  /** Per-cell visualization for numeric columns. Default 'none'. */
  viz?: TableColumnViz;
  /** Numeric display format. Default 'abs'. */
  display?: TableColumnDisplay;
}

export function isDimensionColumn(col: TableColumn): boolean {
  return col.kind === 'dimension';
}

export function isPostFieldColumn(col: TableColumn): boolean {
  return col.kind === 'post-field';
}

export interface CustomTableConfig {
  /** Aggregation mode. 'group' (default — back-compat): rows = cross product of
   *  dimension columns, metric columns aggregate within each group. 'post':
   *  rows = one per post, all columns are `kind: 'post-field'`. */
  mode?: 'group' | 'post';
  /** @deprecated — legacy single group-by. New configs put all dimensions in
   *  `columns` with `kind: 'dimension'`. Kept optional for back-compat; we
   *  normalize at render time via {@link normalizeTableConfig}. */
  dimension?: CustomDimension;
  /** All columns. Dimension columns (`kind: 'dimension'`) jointly define the
   *  row grouping (compound key); metric columns aggregate within each group. */
  columns: TableColumn[];
  /** Column id to sort by. Special: '__rank' (insertion order). Default = first column id. */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Cap on rows kept after sort. Default 25. */
  rowLimit?: number;
  /** Show the leading rank gutter (#). Default true. */
  showRank?: boolean;
  /** Style — minimal subset; chart accent / palette do not apply to tables. */
  density?: 'compact' | 'comfortable';
  striped?: boolean;
}

/** Migrate a legacy `dimension`-on-config table into the canonical form where
 *  all dimensions live in `columns`. If the config already has at least one
 *  `kind: 'dimension'` column, returns it as-is. Otherwise prepends a synthetic
 *  dimension column built from `config.dimension`. Idempotent. */
export function normalizeTableConfig(config: CustomTableConfig): CustomTableConfig {
  const hasDimCol = config.columns.some(isDimensionColumn);
  if (hasDimCol) return config;
  if (!config.dimension) return config;
  const seedId = '__group_0';
  const dimCol: TableColumn = {
    id: seedId,
    kind: 'dimension',
    dimension: config.dimension,
  };
  return {
    ...config,
    columns: [dimCol, ...config.columns],
    // Legacy `sortBy: '__dim'` → sort by the synthesized dim col.
    sortBy: config.sortBy === '__dim' ? seedId : config.sortBy,
  };
}

/** All dimension columns in render order. After normalization these are the
 *  group-by key parts; the compound key is the cross product of their values. */
export function getGroupByDimensionColumns(config: CustomTableConfig): TableColumn[] {
  return normalizeTableConfig(config).columns.filter(isDimensionColumn);
}

export function autoColumnHeader(col: TableColumn): string {
  if (isPostFieldColumn(col) && col.postField) {
    return getPostFieldMeta(col.postField).label;
  }
  if (isDimensionColumn(col) && col.dimension) {
    const dim = col.dimension;
    // Topic dimensions don't exist in DIMENSION_META — try the topic registry
    // first, fall through to post-side. Either way getDimensionMeta returns
    // UNKNOWN_DIMENSION_META rather than crashing if we miss.
    const topicMeta = (dim as string) in TOPIC_DIMENSION_META
      ? TOPIC_DIMENSION_META[dim as TopicDimension]
      : undefined;
    const base = topicMeta?.label ?? getDimensionMeta(dim as CustomDimension).label;
    const dimAgg = col.dimensionAgg ?? 'top';
    return dimAgg === 'distinct_count' ? `# ${base}s` : base;
  }
  const metric = col.metric ?? 'post_count';
  // Topic metric → topic label. Post-side metrics fall through.
  const topicMetricMeta = (metric as string) in TOPIC_METRIC_META
    ? TOPIC_METRIC_META[metric as TopicMetric]
    : undefined;
  if (topicMetricMeta) return topicMetricMeta.label;
  const agg: TableColumnAgg = metric === 'post_count' ? 'count' : (col.agg ?? 'sum');
  const base = METRIC_META[metric as CustomMetric]?.label ?? (metric as string);
  if (metric === 'post_count') return 'Posts';
  switch (agg) {
    case 'avg': return `Avg ${base}`;
    case 'min': return `Min ${base}`;
    case 'max': return `Max ${base}`;
    case 'count': return `# ${base}`;
    default:    return base; // sum → just the metric name
  }
}

/** Bootstrap a sensible table config for a dimension. Matches the Top
 *  Channels / Top Entities designs for known dims; falls back to a single
 *  post-count column for everything else. Dimensions live in `columns` as
 *  the first column (kind: 'dimension'). */
export function defaultTableConfigFor(dimension: CustomDimension): CustomTableConfig {
  const dimCol: TableColumn = { id: '__group_0', kind: 'dimension', dimension };
  if (dimension === 'channel_handle') {
    return {
      columns: [
        dimCol,
        { id: 'posts',    metric: 'post_count' },
        { id: 'avglikes', metric: 'like_count', agg: 'avg' },
        { id: 'avgviews', metric: 'view_count', agg: 'avg' },
      ],
      sortBy: 'posts',
      sortDir: 'desc',
      rowLimit: 10,
      showRank: true,
    };
  }
  if (dimension === 'entities') {
    return {
      columns: [
        dimCol,
        { id: 'mentions', metric: 'post_count', header: 'Mentions' },
        { id: 'views',    metric: 'view_count' },
        { id: 'likes',    metric: 'like_count' },
      ],
      sortBy: 'mentions',
      sortDir: 'desc',
      rowLimit: 10,
      showRank: true,
    };
  }
  return {
    columns: [dimCol, { id: 'posts', metric: 'post_count' }],
    sortBy: 'posts',
    sortDir: 'desc',
    rowLimit: 25,
    showRank: true,
  };
}

/** Bootstrap a topics-backed table — leaderboard layout: topic header,
 *  post_count, total_engagement, signal_score. One row per topic. */
export function defaultTopicTableConfig(): CustomTableConfig {
  return {
    columns: [
      { id: '__group_0',        kind: 'dimension', dimension: 'topic' },
      { id: 'post_count',       metric: 'post_count' },
      { id: 'total_engagement', metric: 'total_engagement' },
      { id: 'signal_score',     metric: 'signal_score' },
    ],
    sortBy: 'signal_score',
    sortDir: 'desc',
    rowLimit: 25,
    showRank: true,
  };
}

/** Bootstrap a post-level (one-row-per-post) table config. Picks a sensible
 *  default column set; user can tweak in TableDataForm. */
export function defaultPostTableConfig(): CustomTableConfig {
  const col = (id: string, postField: PostField, header?: string): TableColumn => ({
    id, kind: 'post-field', postField, header,
  });
  return {
    mode: 'post',
    columns: [
      col('link',      'post_url'),
      col('posted',    'posted_at'),
      col('handle',    'channel_handle'),
      col('content',   'content'),
      col('sentiment', 'sentiment'),
      col('likes',     'like_count'),
      col('views',     'view_count'),
    ],
    sortBy: 'posted',
    sortDir: 'desc',
    rowLimit: 50,
    showRank: false,
  };
}

// ─── Chart style overrides (accent + per-series colors) ─────────────────────

export interface ChartStyleOverrides {
  /** Base accent color for the generated palette. */
  accent?: string;
  /** Per-label color overrides — keyed by the exact label in the data. */
  seriesColors?: Record<string, string>;
  /** Per-label display-name overrides — keyed by the exact raw label in the
   *  data, value is the user-facing name shown in legends, axes, table cells,
   *  tooltips, etc. Empty/missing → fall back to humanised raw label. */
  seriesLabels?: Record<string, string>;
}

/** Aggregations that were superseded by `aggregation: 'custom'` with the right
 *  dimension/breakdown. Stored widgets and agent-emitted layouts may still use
 *  them; we normalize at render time so the dispatch table stays simple. */
const LEGACY_PRESET_AGGREGATIONS: ReadonlySet<SocialAggregation> = new Set([
  'volume',
  'sentiment-over-time',
]);

/** Convert legacy preset widgets to their equivalent `aggregation: 'custom'`
 *  form. Idempotent for already-custom or non-legacy widgets. */
export function normalizeWidgetAggregation<T extends { aggregation: SocialAggregation; chartType: SocialChartType; customConfig?: CustomChartConfig; kpiIndex?: number }>(widget: T): T {
  if (!LEGACY_PRESET_AGGREGATIONS.has(widget.aggregation)) return widget;
  const { customConfig, chartType } = presetToCustomConfig(widget.aggregation, widget.kpiIndex);
  return {
    ...widget,
    aggregation: 'custom',
    chartType: widget.chartType ?? chartType,
    customConfig: widget.customConfig ?? customConfig,
    kpiIndex: undefined,
  };
}

// ─── Filter conditions (advanced per-widget rules) ──────────────────────────

export type FilterConditionField =
  | 'like_count' | 'view_count' | 'comment_count' | 'share_count'
  | 'engagement_total' | 'posted_at' | 'text';

export type FilterConditionOperator =
  | 'greaterThan' | 'lessThan' | 'equals' | 'between'
  | 'before' | 'after' | 'contains' | 'notContains'
  | 'isEmpty' | 'isNotEmpty';

export interface FilterCondition {
  field: FilterConditionField;
  operator: FilterConditionOperator;
  value: string | number;
  value2?: string | number;
}

export const CONDITION_FIELD_OPTIONS: Array<{ value: FilterConditionField; label: string }> = [
  { value: 'like_count', label: 'Likes' },
  { value: 'view_count', label: 'Views' },
  { value: 'comment_count', label: 'Comments' },
  { value: 'share_count', label: 'Shares' },
  { value: 'engagement_total', label: 'Engagement' },
  { value: 'posted_at', label: 'Date Posted' },
  { value: 'text', label: 'Post Text' },
];

export const NUMERIC_CONDITION_FIELDS: FilterConditionField[] = [
  'like_count', 'view_count', 'comment_count', 'share_count', 'engagement_total',
];
export const DATE_CONDITION_FIELDS: FilterConditionField[] = ['posted_at'];
export const TEXT_CONDITION_FIELDS: FilterConditionField[] = ['text'];

export const NUMERIC_OPERATORS: FilterConditionOperator[] = ['greaterThan', 'lessThan', 'equals', 'between'];
export const DATE_OPERATORS: FilterConditionOperator[] = ['before', 'after', 'between'];
export const TEXT_OPERATORS: FilterConditionOperator[] = ['contains', 'notContains', 'isEmpty', 'isNotEmpty'];

export const OPERATOR_LABELS: Record<FilterConditionOperator, string> = {
  greaterThan: 'Greater than',
  lessThan: 'Less than',
  equals: 'Equals',
  between: 'Between',
  before: 'Before',
  after: 'After',
  contains: 'Contains',
  notContains: 'Does not contain',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty',
};

// ─── Widget filters (per-widget overrides on top of global filters) ────────────

export interface SocialWidgetFilters {
  sentiment?: string[];
  emotion?: string[];
  platform?: string[];
  language?: string[];
  content_type?: string[];
  channel_type?: string[];
  collection?: string[];
  channels?: string[];
  themes?: string[];
  entities?: string[];
  brands?: string[];
  /** Per-agent custom enrichment fields. Keyed by field name; selected values
   *  match scalar fields exactly or, for array fields, "any value in selected
   *  intersects post value". */
  custom_fields?: Record<string, string[]>;
  date_range?: { from: string | null; to: string | null };
  conditions?: FilterCondition[];
}

// ─── Report scope (committed by an agent-generated report) ────────────────────
// When set on a dashboard, chart aggregations apply this as a base filter and
// viewer filters intersect with it (can narrow, cannot widen). Absence = the
// dashboard is in standalone mode and the viewer's filter bar is unrestricted.
// Mirrors `ReportScope` in api/routers/dashboard_schema.py.

export interface ReportScope {
  sentiment?: string[] | null;
  emotion?: string[] | null;
  platform?: string[] | null;
  language?: string[] | null;
  content_type?: string[] | null;
  collection?: string[] | null;
  channels?: string[] | null;
  themes?: string[] | null;
  entities?: string[] | null;
  date_range?: { from: string | null; to: string | null } | null;
}

// ─── Widget config ────────────────────────────────────────────────────────────

export interface SocialDashboardWidget {
  /** Unique widget ID (nanoid) */
  i: string;
  /** Grid position */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which BigQuery source the widget reads. Undefined → 'posts' (back-compat).
   *  When 'topics', `customConfig.dimension/metric` are interpreted as
   *  {@link TopicDimension}/{@link TopicMetric} and aggregation runs against
   *  the topics array instead of posts. */
  dataSource?: DataSource;
  /** Which aggregation to run */
  aggregation: SocialAggregation;
  /** 0–4 for kpi type (selects which EnhancedKpi to show) */
  kpiIndex?: number;
  /** How to visualize the data */
  chartType: SocialChartType;
  /** Widget title shown in header */
  title: string;
  /** Optional subtitle / description */
  description?: string;
  /** Legacy: KPI card tint + simple chart accent. New widgets prefer
   *  `styleOverrides.accent`; kept here for KPI cards and back-compat. */
  accent?: string;
  /** Chart style — accent + per-series color overrides. Takes precedence
   *  over `accent` for non-KPI chart widgets. */
  styleOverrides?: ChartStyleOverrides;
  /** Per-widget filters applied on top of global filtered posts */
  filters?: SocialWidgetFilters;
  /** Custom chart configuration — set when aggregation === 'custom' */
  customConfig?: CustomChartConfig;
  /** Table widget configuration — set when chartType === 'table'. Coexists
   *  with `customConfig` so switching chart type ↔ table preserves both. */
  tableConfig?: CustomTableConfig;
  /** Markdown body — set when aggregation === 'text' */
  markdownContent?: string;
  /** Optional figure-style caption rendered below the chart body (figcaption).
   *  The widget's `title` doubles as the figure header — there's only one. */
  figureText?: string;
  /** Visual scale for number-card widgets. Undefined → medium. */
  numberSize?: NumberSize;
}

// ─── WidgetData (Chart.js data format) ────────────────────────────────────────

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface GroupedCategoricalDataset {
  label: string;
  values: number[];
}

export interface WidgetData {
  /** Single numeric value (for number-card) */
  value?: number;
  /** Categorical labels */
  labels?: string[];
  /** Corresponding values */
  values?: number[];
  /** Single time series (for line charts) */
  timeSeries?: TimeSeriesPoint[];
  /** Multi-series time series (grouped line charts) */
  groupedTimeSeries?: Record<string, TimeSeriesPoint[]>;
  /** Grouped categorical data (bar charts with breakdown dimension) */
  groupedCategorical?: {
    labels: string[];
    datasets: GroupedCategoricalDataset[];
  };
  /** Topic widgets only: cluster_id aligned 1:1 with `labels`. Undefined entries
   *  (e.g. the "Others" bucket) suppress click-through for that index. */
  clusterIds?: (string | undefined)[];
}

// ─── Valid chart types per aggregation ───────────────────────────────────────

export const VALID_CHART_TYPES: Record<SocialAggregation, SocialChartType[]> = {
  'kpi': ['number-card'],
  'sentiment': ['doughnut', 'pie', 'bar', 'progress-list'],
  'emotion': ['bar', 'doughnut', 'pie', 'progress-list'],
  'platform': ['bar', 'doughnut', 'pie', 'progress-list'],
  'volume': ['line'],
  'sentiment-over-time': ['line'],
  'theme-cloud': ['word-cloud', 'bar'],
  'themes': ['bar', 'progress-list', 'doughnut'],
  'entities': ['table', 'progress-list'],
  'channels': ['table', 'progress-list'],
  'content-type': ['doughnut', 'pie', 'bar', 'progress-list'],
  'language': ['pie', 'doughnut', 'bar', 'progress-list'],
  'engagement-rate': ['line'],
  'posts': ['data-table'],
  'custom': ['bar', 'pie', 'doughnut', 'line', 'number-card', 'progress-list', 'word-cloud', 'table'],
  'text': ['table'],
};

// ─── Aggregation metadata (for UI display) ────────────────────────────────────

export interface AggregationMeta {
  label: string;
  description: string;
  icon: string;
  defaultChartType: SocialChartType;
  defaultTitle: string;
  defaultSize: { w: number; h: number };
}

export const AGGREGATION_META: Record<SocialAggregation, AggregationMeta> = {
  'kpi': {
    label: 'KPI Card',
    description: 'A single key metric (posts, views, engagement, etc.)',
    icon: 'Hash',
    defaultChartType: 'number-card',
    defaultTitle: 'KPI',
    defaultSize: { w: 3, h: 2 },
  },
  'sentiment': {
    label: 'Sentiment Distribution',
    description: 'Breakdown of post sentiment (positive, negative, neutral)',
    icon: 'Heart',
    defaultChartType: 'doughnut',
    defaultTitle: 'Sentiment',
    defaultSize: { w: 4, h: 6 },
  },
  'emotion': {
    label: 'Emotion Breakdown',
    description: 'AI-classified emotional tone of posts',
    icon: 'Smile',
    defaultChartType: 'bar',
    defaultTitle: 'Emotions',
    defaultSize: { w: 4, h: 6 },
  },
  'platform': {
    label: 'Platform Breakdown',
    description: 'Post volume by social media platform',
    icon: 'Globe',
    defaultChartType: 'bar',
    defaultTitle: 'Platform',
    defaultSize: { w: 4, h: 6 },
  },
  'volume': {
    label: 'Volume Over Time',
    description: 'Daily post count across platforms',
    icon: 'TrendingUp',
    defaultChartType: 'line',
    defaultTitle: 'Volume Over Time',
    defaultSize: { w: 12, h: 6 },
  },
  'sentiment-over-time': {
    label: 'Sentiment Over Time',
    description: 'Daily sentiment distribution trends',
    icon: 'Activity',
    defaultChartType: 'line',
    defaultTitle: 'Sentiment Over Time',
    defaultSize: { w: 12, h: 6 },
  },
  'theme-cloud': {
    label: 'Theme Cloud',
    description: 'Visual word cloud of most discussed topics',
    icon: 'Cloud',
    defaultChartType: 'word-cloud',
    defaultTitle: 'Theme Cloud',
    defaultSize: { w: 6, h: 7 },
  },
  'themes': {
    label: 'Top Themes',
    description: 'Most discussed topics ranked by post count',
    icon: 'Tag',
    defaultChartType: 'bar',
    defaultTitle: 'Top Themes',
    defaultSize: { w: 6, h: 7 },
  },
  'entities': {
    label: 'Top Entities',
    description: 'People, brands, and places mentioned most',
    icon: 'Users',
    defaultChartType: 'table',
    defaultTitle: 'Top Entities',
    defaultSize: { w: 6, h: 8 },
  },
  'channels': {
    label: 'Top Channels',
    description: 'Most active sources with engagement metrics',
    icon: 'Tv',
    defaultChartType: 'table',
    defaultTitle: 'Top Channels',
    defaultSize: { w: 6, h: 8 },
  },
  'content-type': {
    label: 'Content Type',
    description: 'Distribution of content formats (video, image, text, etc.)',
    icon: 'LayoutGrid',
    defaultChartType: 'doughnut',
    defaultTitle: 'Content Type',
    defaultSize: { w: 6, h: 6 },
  },
  'language': {
    label: 'Language Breakdown',
    description: 'Post language distribution across collected content',
    icon: 'MessageSquare',
    defaultChartType: 'pie',
    defaultTitle: 'Language',
    defaultSize: { w: 6, h: 6 },
  },
  'engagement-rate': {
    label: 'Engagement Rate',
    description: 'Daily engagement rate (likes + comments + shares) / views',
    icon: 'Zap',
    defaultChartType: 'line',
    defaultTitle: 'Engagement Rate',
    defaultSize: { w: 12, h: 6 },
  },
  'posts': {
    label: 'Posts Table',
    description: 'Sortable table of all posts with full details',
    icon: 'Table2',
    defaultChartType: 'data-table',
    defaultTitle: 'Posts',
    defaultSize: { w: 12, h: 10 },
  },
  'custom': {
    label: 'Custom Chart',
    description: 'Build your own chart by choosing a metric and dimension',
    icon: 'BarChart2',
    defaultChartType: 'bar',
    defaultTitle: 'Custom Chart',
    defaultSize: { w: 6, h: 6 },
  },
  'text': {
    label: 'Text Card',
    description: 'A markdown text block — use for intros, section headers, or commentary',
    icon: 'FileText',
    defaultChartType: 'table',
    defaultTitle: 'Text',
    defaultSize: { w: 6, h: 3 },
  },
};

// ─── KPI index labels ─────────────────────────────────────────────────────────

export const KPI_OPTIONS = [
  { index: 0, label: 'Total Posts', icon: 'FileText', accent: '#2B5066' },
  { index: 1, label: 'Total Views', icon: 'Eye', accent: '#4A7C8F' },
  { index: 2, label: 'Total Engagement', icon: 'Zap', accent: '#3E6B52' },
  { index: 3, label: 'Engagement Rate', icon: 'TrendingUp', accent: '#6B3040' },
  { index: 4, label: 'Avg Engagement/Post', icon: 'BarChart3', accent: '#4A5568' },
] as const;

// ─── Number-card size presets ────────────────────────────────────────────────

export type NumberSize = 'small' | 'medium' | 'big';

export const DEFAULT_NUMBER_SIZE: NumberSize = 'medium';

/** Grid footprint applied when the user picks a size in the editor. Existing
 *  widgets keep their saved w/h on render — only an explicit size change snaps. */
export const NUMBER_SIZE_GRID: Record<NumberSize, { w: number; h: number }> = {
  small:  { w: 2, h: 1 },
  medium: { w: 3, h: 2 },
  big:    { w: 4, h: 3 },
};
