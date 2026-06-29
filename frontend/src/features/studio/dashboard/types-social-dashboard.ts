import type { CustomFieldDef } from '../../../api/types.ts';

// ─── Core enums ──────────────────────────────────────────────────────────────

/** Which BigQuery source a widget reads from. `posts` (default) = post-level
 *  rows from `scope_posts`. `topics` = topic cluster rows from `topic_metrics`
 *  (one row per cluster in the agent's latest clustering run). `comments` =
 *  comment-level rows from `scope_comments` (post-shaped; reuses the post
 *  vocabulary). `both` = posts ∪ comments. Comment/both widgets render from the
 *  response's `comments` array; default stays posts. */
export type DataSource = 'posts' | 'topics' | 'comments' | 'both';

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
  | 'text'
  | 'embeds'
  | 'media'
  | 'html';

export type SocialChartType =
  | 'bar'
  | 'pie'
  | 'doughnut'
  | 'line'
  | 'word-cloud'
  | 'table'
  | 'number-card'
  | 'progress-list'
  | 'data-table'
  | 'heatmap'
  | 'embed';

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
  // Cyclical time-of-week dimensions derived from `posted_at`. Unlike the
  // continuous `posted_at` buckets, these collapse all timestamps onto a fixed
  // 24-hour / 7-weekday cycle - the two axes of the posting-activity heatmap.
  | 'hour_of_day'
  | 'day_of_week'
  | 'themes'
  | 'entities'
  | 'brands'
  | `custom:${string}`
  // Report-defined if/else computed field with categorical output. See
  // ReportConfig / ComputedField below. Resolved via `computed:<id>`.
  | `computed:${string}`;

export type StandardCustomDimension = Exclude<
  CustomDimension,
  `custom:${string}` | `computed:${string}`
>;

/** Prefix used to namespace agent-defined enrichment fields as group-by dimensions. */
export const CUSTOM_DIM_PREFIX = 'custom:';

export function isCustomFieldDimension(
  dim: AnyDimension | undefined | null,
): dim is `custom:${string}` {
  return typeof dim === 'string' && dim.startsWith(CUSTOM_DIM_PREFIX);
}

export function customFieldName(dim: `custom:${string}`): string {
  return dim.slice(CUSTOM_DIM_PREFIX.length);
}

/**
 * True when a dimension column holds brand names — the built-in `brands`
 * dimension or any custom enrichment field whose name reads as a brand
 * ("brand_name", "brand", "detected_brands", ...). Used to decide whether a
 * table column's values should render with a brand icon. Generalizes the
 * brand-icon treatment beyond one hardcoded field without sprinkling icons on
 * unrelated columns (sentiment, channel, country, ...).
 */
export function isBrandDimension(dim: AnyDimension | undefined | null): boolean {
  if (!dim) return false;
  if (dim === 'brands') return true;
  return isCustomFieldDimension(dim) && /brand/i.test(customFieldName(dim));
}

// ─── list[object] custom fields: leaf dimensions + element metrics ────────────
// A `list[object]` field (e.g. men=[{name,age},...]) is aggregated element-as-
// unit: each object is the counted row, so a post with N objects never inflates
// post-level counts. Leaves are addressed with a dot to distinguish them from a
// scalar custom field:
//   dimension  `custom:men.name`      → group elements by the `name` leaf
//   metric     `customobj:men.age`    → avg/min/max/sum of the numeric `age` leaf
//   metric     `customobj:men.__count`→ count of elements
const OBJECT_DIM_RE = /^custom:([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
export const OBJECT_METRIC_PREFIX = 'customobj:';
// field + any non-empty suffix; the suffix is classified by parseObjectMetric.
const OBJECT_METRIC_RE = /^customobj:([a-z][a-z0-9_]*)\.(.+)$/;
/** Sentinel leaf marking the "count of elements" object metric. */
export const OBJECT_COUNT_LEAF = '__count';
/** Sentinel leaf marking the "distinct parent posts" object metric (dedup per post). */
export const OBJECT_DISTINCT_POSTS_LEAF = '__posts';
/** Suffix prefix marking an inherited parent-post metric, e.g. `post.view_count`. */
export const OBJECT_INHERITED_PREFIX = 'post.';

/** Post metrics an object element may inherit from its parent post. `post_count`
 *  is intentionally excluded (it would equal the element count / `__count`). */
export const OBJECT_INHERITED_METRICS: CustomMetric[] = [
  'view_count', 'like_count', 'comment_count', 'share_count', 'engagement_total',
];
const OBJECT_INHERITED_SET = new Set<string>(OBJECT_INHERITED_METRICS);

export type ObjectMetricKind = 'count' | 'distinctPosts' | 'own' | 'inherited';

/** True for a leaf dimension like `custom:men.name` (dotted), false for a plain
 *  scalar custom dim like `custom:men`. */
export function isObjectFieldDimension(dim: AnyDimension | undefined | null): boolean {
  return typeof dim === 'string' && OBJECT_DIM_RE.test(dim);
}

export function parseObjectDim(dim: string): { field: string; leaf: string } | null {
  const m = OBJECT_DIM_RE.exec(dim);
  return m ? { field: m[1], leaf: m[2] } : null;
}

export function isObjectMetric(metric: AnyMetric | undefined | null): boolean {
  return typeof metric === 'string' && OBJECT_METRIC_RE.test(metric);
}

export interface ParsedObjectMetric {
  field: string;
  kind: ObjectMetricKind;
  /** count → '__count'; distinctPosts → '__posts'; own → the leaf name.
   *  Undefined for inherited. */
  leaf?: string;
  /** inherited only: the parent-post metric to read per element. */
  metric?: CustomMetric;
}

/** Parse a `customobj:<field>.<suffix>` token into its kind:
 *  - `.__count`        → count of elements
 *  - `.__posts`        → distinct parent posts (dedup per post)
 *  - `.post.<metric>`  → inherited parent-post metric (per element)
 *  - `.<leaf>`         → the object's own numeric leaf
 *  Returns null for an unrecognized suffix. */
export function parseObjectMetric(metric: string): ParsedObjectMetric | null {
  const m = OBJECT_METRIC_RE.exec(metric);
  if (!m) return null;
  const field = m[1];
  const suffix = m[2];
  if (suffix === OBJECT_COUNT_LEAF) return { field, kind: 'count', leaf: suffix };
  if (suffix === OBJECT_DISTINCT_POSTS_LEAF) return { field, kind: 'distinctPosts', leaf: suffix };
  if (suffix.startsWith(OBJECT_INHERITED_PREFIX)) {
    const pm = suffix.slice(OBJECT_INHERITED_PREFIX.length);
    return OBJECT_INHERITED_SET.has(pm)
      ? { field, kind: 'inherited', metric: pm as CustomMetric }
      : null;
  }
  return /^[a-z][a-z0-9_]*$/.test(suffix) ? { field, kind: 'own', leaf: suffix } : null;
}

/** Build an inherited object metric token, e.g. ('men','view_count') →
 *  `customobj:men.post.view_count`. */
export function objectInheritedMetric(field: string, metric: CustomMetric): AnyMetric {
  return `${OBJECT_METRIC_PREFIX}${field}.${OBJECT_INHERITED_PREFIX}${metric}` as AnyMetric;
}

/** Default aggregation for an object metric kind: own numeric → avg (summing ages
 *  is meaningless), inherited post metric → sum. count / distinctPosts have no agg. */
export function defaultAggForObjectMetric(
  kind: ObjectMetricKind,
): 'sum' | 'avg' | undefined {
  if (kind === 'own') return 'avg';
  if (kind === 'inherited') return 'sum';
  return undefined;
}

/** The list[object] field a config targets, or null. Reads the object metric
 *  first (the metric is always present), then the leaf dimension. Returns null
 *  when the two reference different fields (an invalid config we won't route). */
export function objectFieldOf(config: CustomChartConfig): string | null {
  const fromMetric = isObjectMetric(config.metric)
    ? parseObjectMetric(config.metric as string)?.field ?? null
    : null;
  const fromDim = isObjectFieldDimension(config.dimension)
    ? parseObjectDim(config.dimension as string)?.field ?? null
    : null;
  if (fromMetric && fromDim && fromMetric !== fromDim) return null;
  return fromMetric ?? fromDim;
}

const OBJECT_NUMERIC_LEAF_TYPES = new Set(['int', 'float']);
const OBJECT_CATEGORICAL_LEAF_TYPES = new Set(['str', 'bool', 'literal']);

/** Object metrics offered for a list[object] field: count-of-elements, distinct
 *  parent posts, one per numeric leaf, then the inherited parent-post metrics. */
export function objectMetricsForDef(def: CustomFieldDef): AnyMetric[] {
  const out: AnyMetric[] = [
    `${OBJECT_METRIC_PREFIX}${def.name}.${OBJECT_COUNT_LEAF}` as AnyMetric,
    `${OBJECT_METRIC_PREFIX}${def.name}.${OBJECT_DISTINCT_POSTS_LEAF}` as AnyMetric,
  ];
  for (const ef of def.element_fields ?? []) {
    if (OBJECT_NUMERIC_LEAF_TYPES.has(ef.type)) {
      out.push(`${OBJECT_METRIC_PREFIX}${def.name}.${ef.name}` as AnyMetric);
    }
  }
  for (const m of OBJECT_INHERITED_METRICS) {
    out.push(objectInheritedMetric(def.name, m));
  }
  return out;
}

/** Object metrics grouped for the editor's Metric dropdown (SelectGroup headers). */
export function objectMetricGroupsForDef(
  def: CustomFieldDef,
): Array<{ label: string; metrics: AnyMetric[] }> {
  const fieldLabel = humanizeFieldName(def.name);
  const count: AnyMetric[] = [
    `${OBJECT_METRIC_PREFIX}${def.name}.${OBJECT_COUNT_LEAF}` as AnyMetric,
    `${OBJECT_METRIC_PREFIX}${def.name}.${OBJECT_DISTINCT_POSTS_LEAF}` as AnyMetric,
  ];
  const own: AnyMetric[] = (def.element_fields ?? [])
    .filter((ef) => OBJECT_NUMERIC_LEAF_TYPES.has(ef.type))
    .map((ef) => `${OBJECT_METRIC_PREFIX}${def.name}.${ef.name}` as AnyMetric);
  const inherited: AnyMetric[] = OBJECT_INHERITED_METRICS.map((m) =>
    objectInheritedMetric(def.name, m),
  );
  const groups: Array<{ label: string; metrics: AnyMetric[] }> = [
    { label: 'Count', metrics: count },
  ];
  if (own.length) groups.push({ label: `${fieldLabel} fields`, metrics: own });
  groups.push({ label: 'Inherited from post', metrics: inherited });
  return groups;
}

/** Object group-by dims offered for a list[object] field: one per categorical
 *  leaf. */
export function objectDimsForDef(def: CustomFieldDef): AnyDimension[] {
  const out: AnyDimension[] = [];
  for (const ef of def.element_fields ?? []) {
    if (OBJECT_CATEGORICAL_LEAF_TYPES.has(ef.type)) {
      out.push(`${CUSTOM_DIM_PREFIX}${def.name}.${ef.name}` as AnyDimension);
    }
  }
  return out;
}

/** The list[object] field a table config targets (via any object dim or metric
 *  column), or null. Mixed fields across columns → null (invalid, won't route). */
export function objectFieldOfTable(config: CustomTableConfig): string | null {
  let field: string | null = null;
  for (const col of config.columns) {
    let f: string | null = null;
    if (isDimensionColumn(col) && isObjectFieldDimension(col.dimension)) {
      f = parseObjectDim(col.dimension as string)?.field ?? null;
    } else if (!isDimensionColumn(col) && !isPostFieldColumn(col) && isObjectMetric(col.metric)) {
      f = parseObjectMetric(col.metric as string)?.field ?? null;
    }
    if (f) {
      if (field && field !== f) return null;
      field = f;
    }
  }
  return field;
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
  const obj = isObjectFieldDimension(dim) ? parseObjectDim(dim) : null;
  if (obj) {
    return {
      label: `${humanizeFieldName(obj.field)} › ${humanizeFieldName(obj.leaf)}`,
      icon: 'Sparkles',
      description: `Group ${humanizeFieldName(obj.field)} items by "${obj.leaf}"`,
    };
  }
  if (isCustomFieldDimension(dim)) {
    const name = customFieldName(dim);
    return {
      label: humanizeFieldName(name),
      icon: 'Sparkles',
      description: `Group by custom enrichment field "${name}"`,
    };
  }
  if (isComputedRef(dim)) {
    const id = computedFieldId(dim);
    return {
      label: humanizeFieldName(id),
      icon: 'Sigma',
      description: `Group by computed field "${id}"`,
    };
  }
  return DIMENSION_META[dim] ?? UNKNOWN_DIMENSION_META;
}

/** Human label for an object element metric token (`customobj:men.age`). */
export function getObjectMetricLabel(metric: string): string {
  const p = parseObjectMetric(metric);
  if (!p) return metric;
  const field = humanizeFieldName(p.field);
  switch (p.kind) {
    case 'count':         return `Count of ${field}`;
    case 'distinctPosts': return `Posts with ${field}`;
    case 'inherited':     return METRIC_META[p.metric as CustomMetric]?.label ?? (p.metric as string);
    default:              return `${field} › ${humanizeFieldName(p.leaf ?? '')}`;
  }
}

export type CustomMetric =
  | 'post_count'
  | 'like_count'
  | 'view_count'
  | 'comment_count'
  | 'share_count'
  | 'engagement_total'
  // list[object] element metrics, e.g. `customobj:men.age`, `customobj:men.__count`
  | `customobj:${string}`
  // Report-defined computed field with numeric output (expr, or if/else→metric).
  // See ReportConfig / ComputedField below. Resolved via `computed:<id>`.
  | `computed:${string}`;

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

/** Widened union for CustomChartConfig - the runtime branches on
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

/** Metrics whose value is a per-topic ratio. Sum is not meaningful - these
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

/** Granularity for time-series (posted_at) aggregation. */
export type TimeBucket = 'hour' | 'day' | 'week' | 'month';

/** A renderable piece of a `mode` ("Top value") number-card. */
export type TopValuePart = 'label' | 'count' | 'percent';

export interface CustomChartConfig {
  /** What to group by. undefined = no groupBy → number-card.
   *  Vocabulary depends on the widget's `dataSource`:
   *  - `'posts'` (default): values are {@link CustomDimension}.
   *  - `'topics'`: values are {@link TopicDimension}. */
  dimension?: AnyDimension;
  /** Vocabulary depends on `dataSource` - see `dimension`. */
  metric: AnyMetric;
  /** default 'sum'. `median` is numeric (over `metric`); `distinct`/`mode` run
   *  over `categoricalField` instead of `metric`; `percent` is `metric` as a
   *  share of the dashboard-scope baseline. `distinct`/`mode`/`percent`/`median`
   *  are number-card only. */
  metricAgg?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'median' | 'distinct' | 'mode' | 'percent';
  /** Categorical field that `distinct` / `mode` aggregations run over (a
   *  dimension token, e.g. `channel_handle`). Ignored for numeric aggregations.
   *  Number-card only. */
  categoricalField?: AnyDimension;
  /** only applies when dimension === 'posted_at' */
  timeBucket?: TimeBucket;
  /** Bar orientation - default 'horizontal' */
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
  /** Plot a running total instead of per-bucket values. Only applies to time
   *  series (dimension === 'posted_at'); categorical charts ignore it. Each
   *  grouped (breakdown) series accumulates independently. */
  cumulative?: boolean;
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
  hour_of_day:    { label: 'Hour of Day',   icon: 'Clock',         description: 'Group by hour of day (00–23)' },
  day_of_week:    { label: 'Day of Week',   icon: 'CalendarDays',  description: 'Group by weekday (Mon–Sun)' },
  themes:         { label: 'Theme',         icon: 'Tag',           description: 'Group by topic / theme' },
  entities:       { label: 'Entity',        icon: 'Users',         description: 'Group by mentioned entity' },
  brands:         { label: 'Brand',         icon: 'Sparkles',      description: 'Group by detected brand' },
};

/** Dimensions that the aggregation framework treats as a datetime/time axis
 *  (the `aggregateCustom` time-series path). These are the valid X-axis choices
 *  for a number-card trendline. Currently only `posted_at`; add here (and teach
 *  `aggregateCustom`) when another datetime dimension becomes available. */
export const DATETIME_DIMENSIONS: CustomDimension[] = ['posted_at'];

// ─── Cyclical time-of-week dimensions (heatmap axes) ──────────────────────────

/** Canonical X-axis order for `hour_of_day`: the 24 zero-padded hours. Used as
 *  both the dimension key (see `getDimensionKeys`) and the full grid order so a
 *  heatmap shows every hour slot even when its count is 0. */
export const HOUR_OF_DAY_LABELS: readonly string[] = Array.from({ length: 24 }, (_, h) =>
  String(h).padStart(2, '0'),
);

/** Canonical row order for `day_of_week`, Monday-first (matches the
 *  posting-activity design). */
export const DAY_OF_WEEK_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `Date.getDay()` (0=Sun..6=Sat) → the Mon-first weekday label in
 *  {@link DAY_OF_WEEK_LABELS}. */
export const WEEKDAY_BY_GETDAY: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dimensions that occupy a fixed cyclical axis - rendered in a canonical order
 *  (not ranked by total) and always shown in full, so the heatmap grid never
 *  drops an empty hour/weekday slot. */
export const CYCLICAL_DIMENSIONS: ReadonlySet<CustomDimension> = new Set<CustomDimension>([
  'hour_of_day',
  'day_of_week',
]);

export function isCyclicalDimension(dim: AnyDimension | undefined | null): boolean {
  return typeof dim === 'string' && CYCLICAL_DIMENSIONS.has(dim as CustomDimension);
}

/** Full ordered label set for a cyclical dimension, or null for any other
 *  (ranked-by-total) dimension. */
export function cyclicalDimensionOrder(dim: AnyDimension | undefined | null): readonly string[] | null {
  if (dim === 'hour_of_day') return HOUR_OF_DAY_LABELS;
  if (dim === 'day_of_week') return DAY_OF_WEEK_LABELS;
  return null;
}

export const METRIC_META: Record<CustomMetric, { label: string; description: string; supportsAvg: boolean }> = {
  post_count:       { label: 'Post Count',        description: 'Number of posts',            supportsAvg: false },
  like_count:       { label: 'Likes',             description: 'Total / avg likes',          supportsAvg: true },
  view_count:       { label: 'Views',             description: 'Total / avg views',          supportsAvg: true },
  comment_count:    { label: 'Comments',          description: 'Total / avg comments',       supportsAvg: true },
  share_count:      { label: 'Shares',            description: 'Total / avg shares',         supportsAvg: true },
  engagement_total: { label: 'Total Engagement',  description: 'Likes + comments + shares',  supportsAvg: true },
};

const ALL_CHART_TYPES: SocialChartType[] = [
  'number-card', 'bar', 'line', 'pie', 'doughnut', 'progress-list', 'word-cloud', 'heatmap', 'table', 'data-table',
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
 *  e.g. "1,234 (12.3%)". 'none' = no value label (chart value-labels only -
 *  table columns always render a value). Ignored for string dimension cells. */
export type TableColumnDisplay = 'abs' | 'pct' | 'abs_pct' | 'none';

/** Body/header text size for a table widget. 'xs' (default) matches the
 *  historical compact look; 'sm'/'base' make the table read larger in a brief. */
export type TableFontSize = 'xs' | 'sm' | 'base';

/** Post-level field - used when `CustomTableConfig.mode === 'post'`. One row per
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
  | 'numeric'   // numeric - supports viz/display
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
  /** Stable key - also used as the sort key. */
  id: string;
  /** 'metric' (default - back-compat) | 'dimension' | 'post-field' (post mode). */
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
  /** Aggregation mode. 'group' (default - back-compat): rows = cross product of
   *  dimension columns, metric columns aggregate within each group. 'post':
   *  rows = one per post, all columns are `kind: 'post-field'`. */
  mode?: 'group' | 'post';
  /** @deprecated - legacy single group-by. New configs put all dimensions in
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
  /** Style - minimal subset; chart accent / palette do not apply to tables. */
  density?: 'compact' | 'comfortable';
  striped?: boolean;
  /** Table accent color. Recolors the in-cell bar/heatmap viz and (with
   *  `headerBold`) tints the header band. Undefined = theme primary. */
  accent?: string;
  /** Body + header text size. Default 'xs'. */
  fontSize?: TableFontSize;
  /** Render a bolder, accent-tinted header band. */
  headerBold?: boolean;
  /** Bold the leading identity (first dimension) column. */
  emphasizeFirstColumn?: boolean;
  /** Column sizing. 'equal' (default): columns share width evenly. 'value':
   *  widths track each column's content (label columns wider than numeric). */
  columnWidth?: 'equal' | 'value';
  /** Optional secondary dimension. When set (group mode only), each group row
   *  becomes expandable to reveal a per-group breakdown by this dimension,
   *  carrying the table's metric columns. Undefined = no breakdown (default). */
  breakdownDimension?: CustomDimension;
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
    // Topic dimensions don't exist in DIMENSION_META - try the topic registry
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
  // Object element metric → "Count of Men" / "Posts with Men" / "Avg Men › Age" / "Views".
  if (isObjectMetric(metric)) {
    const parsed = parseObjectMetric(metric as string);
    const objBase = getObjectMetricLabel(metric as string);
    // count / distinctPosts have no aggregation prefix.
    if (parsed?.kind === 'count' || parsed?.kind === 'distinctPosts') return objBase;
    const defAgg = parsed?.kind === 'inherited' ? 'sum' : 'avg';
    switch (col.agg ?? defAgg) {
      case 'avg': return `Avg ${objBase}`;
      case 'min': return `Min ${objBase}`;
      case 'max': return `Max ${objBase}`;
      case 'count': return `# ${objBase}`;
      default:    return objBase;
    }
  }
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

/** Bootstrap a topics-backed table - leaderboard layout: topic header,
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

/** What the on-slice label shows for pie/doughnut: the category name, one of the
 *  numeric formats (shared with `TableColumnDisplay`), or nothing. */
export type SliceLabelContent = 'none' | 'name' | 'abs' | 'pct' | 'abs_pct';

export interface ChartStyleOverrides {
  /** Base accent color for the generated palette. */
  accent?: string;
  /** Per-label color overrides - keyed by the exact label in the data. */
  seriesColors?: Record<string, string>;
  /** Per-label display-name overrides - keyed by the exact raw label in the
   *  data, value is the user-facing name shown in legends, axes, table cells,
   *  tooltips, etc. Empty/missing → fall back to humanised raw label. */
  seriesLabels?: Record<string, string>;
  /** How numeric value labels render on the chart (bar/line on-chart labels,
   *  pie/doughnut legend entries): absolute number, percent of total shown, or
   *  both. Unset preserves each chart's historical default (pie/doughnut =
   *  percent, others = absolute) - see `resolveLabelDisplay`. */
  labelDisplay?: TableColumnDisplay;
  /** Pie/doughnut only: what the on-slice label shows (category name or a
   *  numeric format), independent of the legend (`labelDisplay`). Unset → 'none'
   *  (bare slices, the historical default). */
  sliceLabelDisplay?: SliceLabelContent;
  /** Doughnut only: custom text shown inside the donut, above the KPI number.
   *  Unset → falls back to the active metric's label. */
  centerLabel?: string;
  /** Word-cloud only: size multiplier applied on top of the adaptive
   *  (container-width-driven) font range. 1 = default. */
  wordCloudScale?: number;
  /** Bar/line only: visibility + title override for the rendered screen X axis
   *  (Chart.js scales.x). Undefined → axis shown, no title. */
  xAxis?: ChartAxisStyle;
  /** Bar/line only: same as `xAxis` for the screen Y axis (Chart.js scales.y). */
  yAxis?: ChartAxisStyle;
}

/** Per-axis style override for the Cartesian (bar/line) chart axes. */
export interface ChartAxisStyle {
  /** Hide the whole axis - line, ticks, gridlines and title. Default: shown. */
  hidden?: boolean;
  /** Draw the axis title. Default: off (Chart.js renders no axis title). */
  showTitle?: boolean;
  /** Custom axis-title text. Empty/unset → the system default (the dimension or
   *  metric name for that axis). Only rendered when `showTitle` is on. */
  title?: string;
}

/** Chart types that draw Cartesian axes and so expose axis show/hide + title
 *  controls. Circular (pie/doughnut), word-cloud, tables and number-cards have
 *  no x/y axes. */
export const AXIS_CHART_TYPES: SocialChartType[] = ['bar', 'line'];

/** System-default axis titles - the placeholder shown in the editor and the
 *  text used when an axis title is enabled without a custom override. Accounts
 *  for chart type and bar orientation so `x`/`y` line up with the rendered
 *  screen axes (Chart.js scales.x / scales.y). */
export function defaultAxisTitles(
  config: CustomChartConfig | undefined,
  chartType: SocialChartType,
  dataSource: DataSource = 'posts',
): { x: string; y: string } {
  if (!config) return { x: '', y: '' };
  const isTopics = dataSource === 'topics';
  const metricLabel = isTopics
    ? (TOPIC_METRIC_META[config.metric as TopicMetric]?.label ?? String(config.metric))
    : isObjectMetric(config.metric)
      ? getObjectMetricLabel(config.metric as string)
      : (METRIC_META[config.metric as CustomMetric]?.label ?? String(config.metric));
  const dimLabel = config.dimension
    ? (isTopics
        ? getTopicDimensionMeta(config.dimension as TopicDimension).label
        : getDimensionMeta(config.dimension as CustomDimension).label)
    : '';
  if (chartType === 'line') {
    // Line: X is always the time/category axis, Y the value axis.
    return { x: dimLabel || 'Date', y: metricLabel };
  }
  // Bar: a 'vertical' orientation renders horizontal bars (indexAxis 'y'), so
  // the category sits on Y and the value on X. Otherwise category on X.
  const horizontalBars = config.barOrientation === 'vertical';
  return horizontalBars
    ? { x: metricLabel, y: dimLabel }
    : { x: dimLabel, y: metricLabel };
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
  // A number-card that carries a custom metric was meant to be a custom KPI:
  // the CustomWidget path reads the metric from customConfig, labels it with the
  // widget's title, and honors per-widget filters. Left as aggregation:'kpi' it
  // routes to the canonical KpiWidget, which IGNORES customConfig and renders a
  // fixed dashboard-wide metric chosen by kpiIndex - that's the "every story KPI
  // shows Total Posts" bug. Coerce to custom so the intended metric renders.
  if (
    widget.aggregation === 'kpi'
    && widget.chartType === 'number-card'
    && widget.customConfig?.metric
  ) {
    return { ...widget, aggregation: 'custom' as const, kpiIndex: undefined };
  }
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

/** Built-in numeric/date/text post fields, the synthetic `post_count`
 *  group-row filter, categorical built-ins, and dynamic `custom:<name>` fields. */
export type FilterConditionField =
  | 'like_count' | 'view_count' | 'comment_count' | 'share_count'
  | 'engagement_total' | 'posted_at' | 'text'
  | 'post_count'                                   // aggregation row filter (by `dimension`)
  | 'sentiment' | 'emotion' | 'platform' | 'language'
  | 'content_type' | 'channel_type' | 'channel_handle'
  | 'themes' | 'entities' | 'brands'
  | `custom:${string}`;

export type FilterConditionOperator =
  | 'greaterThan' | 'lessThan' | 'equals' | 'between'
  | 'before' | 'after' | 'contains' | 'notContains'
  | 'isEmpty' | 'isNotEmpty'
  | 'isAnyOf' | 'isNoneOf';                         // categorical multi-select

export interface FilterCondition {
  field: FilterConditionField;
  operator: FilterConditionOperator;
  value: string | number;
  value2?: string | number;
  /** Selected values for `isAnyOf` / `isNoneOf`. */
  values?: string[];
  /** Group-by dimension counted when `field === 'post_count'`. */
  dimension?: CustomDimension;
}

/** Discriminates how a condition field is edited + evaluated. */
export type ConditionFieldKind = 'numeric' | 'date' | 'text' | 'categorical' | 'postCount';

/** Base (always-present) field options; the form augments this with `post_count`,
 *  categorical built-ins, and per-custom-field entries at render time. */
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
/** Categorical built-ins: scalar (sentiment…channel_handle) + multi-valued. */
export const CATEGORICAL_CONDITION_FIELDS: FilterConditionField[] = [
  'sentiment', 'emotion', 'platform', 'language', 'content_type', 'channel_type', 'channel_handle',
  'themes', 'entities', 'brands',
];
/** Built-in multi-valued categorical fields (custom `list[str]` detected at runtime). */
export const MULTIVALUED_CONDITION_FIELDS: FilterConditionField[] = ['themes', 'entities', 'brands'];

export const NUMERIC_OPERATORS: FilterConditionOperator[] = ['greaterThan', 'lessThan', 'equals', 'between'];
export const DATE_OPERATORS: FilterConditionOperator[] = ['before', 'after', 'between'];
export const TEXT_OPERATORS: FilterConditionOperator[] = ['contains', 'notContains', 'isEmpty', 'isNotEmpty'];
export const CATEGORICAL_OPERATORS: FilterConditionOperator[] = ['isAnyOf', 'isNoneOf'];

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
  isAnyOf: 'Is any of',
  isNoneOf: 'Is none of',
};

/** True for the synthetic group-count row filter (handled at the aggregation
 *  layer, never at the post level). */
export function isPostCountCondition(cond: FilterCondition): boolean {
  return cond.field === 'post_count';
}

/** Classify a condition field to pick its operators + input widget. Custom
 *  fields resolve their kind from `customFieldDefs` (numeric `int`/`float` →
 *  numeric, `list[str]`/`literal`/`bool` → categorical, `str` → text); object
 *  leaves (`custom:men.name`) and unknown custom fields fall back to categorical. */
export function conditionFieldKind(
  field: FilterConditionField,
  customFieldDefs?: CustomFieldDef[] | null,
): ConditionFieldKind {
  if (field === 'post_count') return 'postCount';
  if (NUMERIC_CONDITION_FIELDS.includes(field)) return 'numeric';
  if (DATE_CONDITION_FIELDS.includes(field)) return 'date';
  if (TEXT_CONDITION_FIELDS.includes(field)) return 'text';
  if (CATEGORICAL_CONDITION_FIELDS.includes(field)) return 'categorical';
  if (field.startsWith(CUSTOM_DIM_PREFIX)) {
    const name = customFieldName(field as `custom:${string}`);
    if (name.includes('.')) return 'categorical'; // object leaf
    const def = customFieldDefs?.find((d) => d.name === name);
    if (def?.type === 'int' || def?.type === 'float') return 'numeric';
    if (def?.type === 'str') return 'text';
    return 'categorical'; // bool, literal, list[str], or unknown
  }
  return 'text';
}

/** Operators valid for a field, by kind. */
export function operatorsForConditionField(
  field: FilterConditionField,
  customFieldDefs?: CustomFieldDef[] | null,
): FilterConditionOperator[] {
  switch (conditionFieldKind(field, customFieldDefs)) {
    case 'numeric': return NUMERIC_OPERATORS;
    case 'postCount': return NUMERIC_OPERATORS;
    case 'date': return DATE_OPERATORS;
    case 'categorical': return CATEGORICAL_OPERATORS;
    default: return TEXT_OPERATORS;
  }
}

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
  /** Topic cluster ids (any-of match on the post's topic membership). The
   *  agent's per-section Story Mode baseline. */
  topics?: string[];
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
  topics?: string[] | null;
  date_range?: { from: string | null; to: string | null } | null;
}

// ─── Report config (report-level defaults above per-widget config) ────────────
// Persisted on the dashboard layout doc as `reportConfig`. The authoritative
// server transform applies it ONCE to the shared posts array (consumed by the
// interactive dashboard, the Brief, and shareable reports) so every consumer
// sees identical canonical data. Per-widget config overrides the report default
// only when intentionally set. See docs/report-config-architecture.md.
// Mirrors `ReportConfig` in api/routers/dashboard_schema.py.

/** Fields a canonicalization group / value color can target: scalar +
 *  multi-valued built-ins, plus dynamic `custom:<name>` enrichment fields. */
export type FieldKey =
  | 'sentiment'
  | 'emotion'
  | 'platform'
  | 'language'
  | 'content_type'
  | 'channel_type'
  | 'themes'
  | 'entities'
  | 'brands'
  | `custom:${string}`;

/** Groups raw values into one canonical value, per chosen fields. On a
 *  multi-valued field the transform remaps THEN dedupes within each post's
 *  array, so merging can only drop or move counts, never inflate them. A raw
 *  value may belong to at most one group per field (validated at save). */
export interface CanonGroup {
  id: string;
  /** The value the members collapse into, e.g. "Cal". */
  canonical: string;
  /** Raw values mapped to `canonical`, e.g. ["cal", "Cal credit cards"]. */
  members: string[];
  /** Which fields this grouping applies to. */
  fields: FieldKey[];
}

/** Closed arithmetic AST for an `expr` computed field. The operator/function
 *  set is intentionally small so the TS and Python evaluators stay identical.
 *  A `field` ref is a numeric leaf metric aggregated per bucket BEFORE the
 *  expression evaluates (aggregate-then-evaluate → correct weighted ratios). */
export type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'field'; ref: AnyMetric }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: ExprNode; r: ExprNode }
  | { t: 'fn'; fn: 'min' | 'max' | 'abs'; args: ExprNode[] };

/** One case of an if/elif/else computed field: when ALL `when` conditions hold
 *  (AND), the field takes `value`. Cases evaluate in order, first match wins;
 *  no match → the field's `elseValue`. */
export interface IfElseCase {
  when: FilterCondition[];
  value: string | number;
}

/** A report-defined field, referenced elsewhere as `computed:<id>`.
 *  - `expr`   → numeric metric, evaluated over per-bucket aggregated leaves.
 *  - `ifelse` → categorical dimension, or per-post numeric metric. */
export type ComputedField =
  | { id: string; name: string; kind: 'expr'; expr: ExprNode; output: 'metric' }
  | {
      id: string;
      name: string;
      kind: 'ifelse';
      cases: IfElseCase[];
      elseValue: string | number;
      output: 'dimension' | 'metric';
    };

export interface ReportConfig {
  /** Value groupings applied to the shared posts before any aggregation. */
  canonicalization?: CanonGroup[];
  /** Report-wide value colors, keyed by {@link FieldKey} → canonical value →
   *  hex. A widget's `styleOverrides.seriesColors` overrides these when set. */
  valueColors?: Record<string, Record<string, string>>;
  /** Report-defined computed fields, referenced as `computed:<id>`. */
  computedFields?: ComputedField[];
}

/** Prefix marking a computed-field reference inside the dimension/metric
 *  vocabularies (mirrors {@link CUSTOM_DIM_PREFIX} for custom enrichment fields). */
export const COMPUTED_PREFIX = 'computed:';

export function isComputedRef(
  ref: AnyDimension | AnyMetric | undefined | null,
): ref is `computed:${string}` {
  return typeof ref === 'string' && ref.startsWith(COMPUTED_PREFIX);
}

export function computedFieldId(ref: `computed:${string}`): string {
  return ref.slice(COMPUTED_PREFIX.length);
}

// ─── Widget config ────────────────────────────────────────────────────────────

/** Media-widget payload (aggregation === 'media'). */
export interface SocialMediaConfig {
  /** 'image' covers png/jpg/webp + animated GIF (rendered via <img>); 'video'
   *  is mp4/webm (rendered via <video>). */
  kind: 'image' | 'video';
  /** External URL when added by link. Ignored when `uploadPath` is set. */
  src?: string;
  /** GCS blob path of an uploaded file; served via `/media/<uploadPath>`. */
  uploadPath?: string;
  /** How the media fills the widget frame. Undefined → 'contain'. */
  fit?: 'cover' | 'contain';
  /** Alt text (images) / accessible label. */
  alt?: string;
  // ── video-only display toggles (all default sensibly when undefined) ──
  loop?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  controls?: boolean;
}

// ─── Embed Posts widget config (aggregation === 'embeds') ─────────────────────

/** Where the embed widget's posts come from. `urls` (default, back-compat) =
 *  manual links in `embedUrls`. `collection` = posts auto-selected from the
 *  agent's collected data (the same posts feeding the dashboard's charts),
 *  ranked by a metric and capped to a count. */
export type EmbedSource = 'urls' | 'collection';

/** How collection-mode posts are laid out. `grid` = a horizontally-scrollable
 *  row of post cards; `marquee` = the same cards auto-scrolling continuously. */
export type EmbedDisplay = 'grid' | 'marquee';

/** Metric used to rank candidate posts in collection mode. `recent` orders by
 *  `posted_at` (newest first); the rest are post-level engagement counts. */
export type EmbedRankMetric =
  | 'view_count'
  | 'like_count'
  | 'comment_count'
  | 'share_count'
  | 'engagement_total'
  | 'recent';

/** Marquee scroll speed (collection + `display: 'marquee'`). */
export type EmbedSpeed = 'slow' | 'normal' | 'fast';

export const DEFAULT_EMBED_RANK: EmbedRankMetric = 'view_count';
export const DEFAULT_EMBED_COUNT = 8;
export const MAX_EMBED_COUNT = 30;

export const EMBED_RANK_LABELS: Record<EmbedRankMetric, string> = {
  view_count: 'Most views',
  like_count: 'Most likes',
  comment_count: 'Most comments',
  share_count: 'Most shares',
  engagement_total: 'Most engagement',
  recent: 'Most recent',
};

/** Collection-mode embed configuration. Persisted on the widget; the renderer
 *  resolves it against the dashboard posts at display time so the selection
 *  stays live as the data refreshes. URL mode keeps using `embedUrls`. */
export interface SocialEmbedConfig {
  /** `urls` (default) or `collection`. */
  source?: EmbedSource;
  /** Collection-mode layout. Undefined → 'grid'. */
  display?: EmbedDisplay;
  /** Collection-mode ranking metric. Undefined → 'view_count'. */
  rankBy?: EmbedRankMetric;
  /** Collection-mode cap on selected posts (before manual hiding).
   *  Undefined → 8. */
  count?: number;
  /** post_ids manually hidden from the auto-selection (the show/hide toggles). */
  hiddenPostIds?: string[];
  /** Marquee scroll speed. Undefined → 'normal'. */
  speed?: EmbedSpeed;
}

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
  /** Chart style - accent + per-series color overrides. Takes precedence
   *  over `accent` for non-KPI chart widgets. */
  styleOverrides?: ChartStyleOverrides;
  /** Per-widget filters applied on top of global filtered posts */
  filters?: SocialWidgetFilters;
  /** Custom chart configuration - set when aggregation === 'custom' */
  customConfig?: CustomChartConfig;
  /** Table widget configuration - set when chartType === 'table'. Coexists
   *  with `customConfig` so switching chart type ↔ table preserves both. */
  tableConfig?: CustomTableConfig;
  /** Markdown body - set when aggregation === 'text' */
  markdownContent?: string;
  /** Self-contained HTML snippet - set when aggregation === 'html'. Rendered
   *  sanitized (DOMPurify, scripts/event-handlers/javascript: URLs stripped)
   *  into a Shadow DOM so its CSS can't leak into the rest of the dashboard.
   *  Authoring is super-admin-only; static content (no live data binding). */
  htmlContent?: string;
  /** Post URLs to embed - set when aggregation === 'embeds' with
   *  `embedConfig.source === 'urls'` (or no embedConfig, the back-compat
   *  default). Mode (single vs carousel) is derived from length at render time. */
  embedUrls?: string[];
  /** Embed Posts widget config - set when aggregation === 'embeds'. Absent →
   *  legacy URL-only behaviour (`embedUrls`). When `source === 'collection'`,
   *  posts are auto-selected from the dashboard data and `embedUrls` is ignored. */
  embedConfig?: SocialEmbedConfig;
  /** Media payload - set when aggregation === 'media'. Either an uploaded
   *  file (served via `/media/<uploadPath>`) or an external URL (`src`). */
  media?: SocialMediaConfig;
  /** Optional figure-style caption rendered below the chart body (figcaption).
   *  The widget's `title` doubles as the figure header - there's only one. */
  figureText?: string;
  /** Visual scale for number-card widgets. Undefined → medium. */
  numberSize?: NumberSize;
  /** Trendline (sparkline) visibility for number-card widgets. Undefined →
   *  size default (small off, medium/big on). Explicit value overrides. */
  showSparkline?: boolean;
  /** X-axis datetime dimension for the number-card trendline. Undefined →
   *  'posted_at'. The series is produced by the standard `aggregateCustom`
   *  time-series path, so only datetime dimensions are valid here. */
  trendDimension?: CustomDimension;
  /** Time bucket for the number-card trendline X-axis. Undefined → 'day'. */
  trendTimeBucket?: TimeBucket;
  /** When true, the number-card trendline shows a running total (cumulative)
   *  rather than per-bucket values. Undefined → false. */
  trendCumulative?: boolean;
  /** Which pieces a `mode` ("Top value") number-card renders, in order.
   *  Undefined → `['label']`. e.g. `['label','count','percent']` →
   *  "positive · 1,240 · 31%". Ignored for non-`mode` aggregations. */
  topValueParts?: TopValuePart[];
  /** Set once the user manually resizes a text/embed card. Disables the
   *  auto-fit-height behaviour so the saved `h` is respected (content scrolls
   *  if it overflows). Undefined → legacy auto-fit for untouched cards. */
  manualHeight?: boolean;
  /** Explicit container (card surface + border + shadow) visibility. Undefined
   *  → the per-widget default (see {@link widgetContainerVisible}): visible for
   *  everything except a heading-only text widget (the "header"). A set value
   *  overrides that default so the user can frame a header or unframe any
   *  widget. */
  showContainer?: boolean;
  /** Overlay a small Scolto brand watermark (mark + wordmark) in the widget's
   *  top-right corner. Undefined → off. Opt-in per widget via the Style tab;
   *  renders in every mode (editor preview + shared/Brief). */
  showWatermark?: boolean;
  /** Widget stays in the layout but is excluded from view mode, shared
   *  dashboards, and PDF export. Edit mode renders it dimmed with a "Hidden"
   *  badge. Undefined → visible (legacy widgets have no key). Mirrors the
   *  Pydantic field in api/routers/dashboard_schema.py. */
  hidden?: boolean;
  /** P2 server-side aggregation: pre-computed `WidgetData` injected by the
   *  public-share host (from the `?agg=server` response's `widgetData` map) for
   *  widgets the server can reproduce exactly. When present, read-only render
   *  uses it verbatim instead of aggregating posts client-side. Never persisted
   *  (transient, view-only); absent for studio and for unflagged shares. */
  serverData?: WidgetData;
  /** P2: server-computed table rows (group / object tables), same role as
   *  serverData but for `chartType: 'table'`. Structurally a `TableRow[]`; typed
   *  loosely here to avoid importing from dashboard-aggregations (cycle). */
  serverTableRows?: Array<Record<string, string | number | string[] | undefined>>;
  /** P2: ordered post_ids a feed (embeds collection) widget displays, resolved
   *  server-side. The post bodies arrive in the (bounded) `posts` array. */
  serverPostIds?: string[];
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
  /** String result for number-card aggregations whose result is a label, not a
   *  number (currently `mode` / "Top value"). When set, `value` carries the
   *  supporting count. */
  stringValue?: string;
  /** How a number-card should format `value`. Set by aggregations whose result
   *  is inherently a percentage (`percent`). Undefined → plain number. */
  format?: 'number' | 'percent';
  /** Denominator for a `mode` ("Top value") card's percentage: the count of
   *  values that are present (missing values excluded). `value / valueTotal` is
   *  the top value's share among posts that actually have a value. */
  valueTotal?: number;
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
  'custom': ['bar', 'pie', 'doughnut', 'line', 'number-card', 'progress-list', 'word-cloud', 'heatmap', 'table'],
  'text': ['table'],
  'embeds': ['embed'],
  'media': ['embed'],
  'html': ['embed'],
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
    description: 'A markdown text block - use for intros, section headers, or commentary',
    icon: 'FileText',
    defaultChartType: 'table',
    defaultTitle: 'Text',
    defaultSize: { w: 6, h: 3 },
  },
  'embeds': {
    label: 'Embed Posts',
    description: 'Embed one or more social posts by URL - single view or auto-carousel',
    icon: 'Quote',
    defaultChartType: 'embed',
    defaultTitle: 'Embedded Posts',
    defaultSize: { w: 4, h: 8 },
  },
  'media': {
    label: 'Image / Video',
    description: 'Show an image, GIF, or video - upload a file or paste a link',
    icon: 'Image',
    defaultChartType: 'embed',
    defaultTitle: 'Media',
    defaultSize: { w: 4, h: 6 },
  },
  'html': {
    label: 'HTML / Embed',
    description: 'Paste a self-contained HTML snippet - banners, CTAs, animated callouts',
    icon: 'Code',
    defaultChartType: 'embed',
    defaultTitle: 'HTML',
    defaultSize: { w: 6, h: 4 },
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
 *  widgets keep their saved w/h on render - only an explicit size change snaps. */
export const NUMBER_SIZE_GRID: Record<NumberSize, { w: number; h: number }> = {
  small:  { w: 2, h: 1 },
  medium: { w: 3, h: 2 },
  big:    { w: 4, h: 3 },
};
