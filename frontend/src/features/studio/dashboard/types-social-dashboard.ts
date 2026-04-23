// ─── Core enums ──────────────────────────────────────────────────────────────

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

export type CustomDimension =
  | 'platform'
  | 'sentiment'
  | 'emotion'
  | 'language'
  | 'content_type'
  | 'channel_handle'
  | 'posted_at'
  | 'themes'
  | 'entities';

export type CustomMetric =
  | 'post_count'
  | 'like_count'
  | 'view_count'
  | 'comment_count'
  | 'share_count'
  | 'engagement_total';

export interface CustomChartConfig {
  /** What to group by. undefined = no groupBy → number-card */
  dimension?: CustomDimension;
  metric: CustomMetric;
  /** default 'sum' */
  metricAgg?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  /** only applies when dimension === 'posted_at' */
  timeBucket?: 'day' | 'week' | 'month';
  /** Bar orientation — default 'horizontal' */
  barOrientation?: 'horizontal' | 'vertical';
  /** Optional second dimension to split bars/slices into sub-groups */
  breakdownDimension?: CustomDimension;
}

export const DIMENSION_META: Record<CustomDimension, { label: string; icon: string; description: string }> = {
  platform:       { label: 'Platform',      icon: 'Globe',         description: 'Group by social platform' },
  sentiment:      { label: 'Sentiment',     icon: 'Heart',         description: 'Group by sentiment label' },
  emotion:        { label: 'Emotion',       icon: 'Smile',         description: 'Group by emotional tone' },
  language:       { label: 'Language',      icon: 'MessageSquare', description: 'Group by post language' },
  content_type:   { label: 'Content Type',  icon: 'LayoutGrid',    description: 'Group by content format' },
  channel_handle: { label: 'Channel',       icon: 'Tv',            description: 'Group by source channel' },
  posted_at:      { label: 'Date',          icon: 'Calendar',      description: 'Group by date over time' },
  themes:         { label: 'Theme',         icon: 'Tag',           description: 'Group by topic / theme' },
  entities:       { label: 'Entity',        icon: 'Users',         description: 'Group by mentioned entity' },
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
      return { customConfig: { dimension: 'posted_at', metric: 'post_count', timeBucket: 'day' }, chartType: 'line' };
    case 'sentiment-over-time':
      return { customConfig: { dimension: 'posted_at', metric: 'post_count', timeBucket: 'day' }, chartType: 'line' };
    case 'engagement-rate':
      return { customConfig: { dimension: 'posted_at', metric: 'engagement_total', timeBucket: 'day' }, chartType: 'line' };
    case 'posts':
      return { customConfig: { metric: 'post_count' }, chartType: 'data-table' };
    default:
      return { customConfig: { metric: 'post_count' }, chartType: 'bar' };
  }
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
  collection?: string[];
  channels?: string[];
  themes?: string[];
  entities?: string[];
  date_range?: { from: string | null; to: string | null };
  conditions?: FilterCondition[];
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
  /** Optional color accent for number cards */
  accent?: string;
  /** Per-widget filters applied on top of global filtered posts */
  filters?: SocialWidgetFilters;
  /** Custom chart configuration — set when aggregation === 'custom' */
  customConfig?: CustomChartConfig;
  /** Markdown body — set when aggregation === 'text' */
  markdownContent?: string;
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
  'custom': ['bar', 'pie', 'doughnut', 'line', 'number-card', 'progress-list', 'word-cloud'],
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
