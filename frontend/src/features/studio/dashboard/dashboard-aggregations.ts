import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { CustomChartConfig, CustomDimension, CustomMetric, CustomTableConfig, PostField, TableColumn, WidgetData, ComputedField } from './types-social-dashboard.ts';
import { evaluateExpr, exprLeafRefs } from './report-expr.ts';
import { isCustomFieldDimension, customFieldName, isCustomPostField, isDimensionColumn, isPostFieldColumn, normalizeTableConfig, isComputedRef, computedFieldId } from './types-social-dashboard.ts';
import { toCumulativeSeries } from './sparkline-visibility.ts';

// ─── Sentiment ───────────────────────────────────────────────────────

export interface SentimentBreakdown {
  sentiment: string;
  count: number;
  percentage: number;
}

export function aggregateSentiment(posts: DashboardPost[]): SentimentBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const s = p.sentiment || 'unknown';
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const total = posts.length;
  return [...counts.entries()]
    .map(([sentiment, count]) => ({
      sentiment,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Platform ────────────────────────────────────────────────────────

export interface PlatformBreakdown {
  platform: string;
  post_count: number;
  view_count: number;
  engagement_count: number;
}

export function aggregatePlatforms(posts: DashboardPost[]): PlatformBreakdown[] {
  const map = new Map<string, { posts: number; views: number; engagement: number }>();
  for (const p of posts) {
    const cur = map.get(p.platform) ?? { posts: 0, views: 0, engagement: 0 };
    cur.posts += 1;
    cur.views += p.view_count ?? 0;
    cur.engagement += (p.like_count ?? 0) + (p.comment_count ?? 0) + (p.share_count ?? 0);
    map.set(p.platform, cur);
  }
  return [...map.entries()]
    .map(([platform, v]) => ({
      platform,
      post_count: v.posts,
      view_count: v.views,
      engagement_count: v.engagement,
    }))
    .sort((a, b) => b.post_count - a.post_count);
}

// ─── Channel type × sentiment (views-weighted) ───────────────────────

export const SENT_KEYS = ['positive', 'neutral', 'mixed', 'negative'] as const;
export type SentimentKey = (typeof SENT_KEYS)[number];

export interface ChannelTypeViewBreakdown {
  type: string;
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

/** Aggregate views by channel_type, broken down by sentiment. */
export function aggregateChannelTypeViews(posts: DashboardPost[]): ChannelTypeViewBreakdown[] {
  const map = new Map<string, { total: number; positive: number; negative: number; neutral: number; mixed: number }>();
  for (const p of posts) {
    const ct = p.channel_type || 'unknown';
    const cur = map.get(ct) ?? { total: 0, positive: 0, negative: 0, neutral: 0, mixed: 0 };
    cur.total += p.view_count;
    const s = (p.sentiment ?? 'neutral').toLowerCase() as keyof typeof cur;
    if (s in cur && s !== 'total') cur[s] += p.view_count;
    else cur.neutral += p.view_count;
    map.set(ct, cur);
  }
  return [...map.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.total - a.total);
}

// ─── Themes ──────────────────────────────────────────────────────────

export interface ThemeBreakdown {
  theme: string;
  post_count: number;
  percentage: number;
}

export function aggregateThemes(posts: DashboardPost[]): ThemeBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.themes ?? []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const total = posts.length;
  return [...counts.entries()]
    .map(([theme, post_count]) => ({
      theme,
      post_count,
      percentage: total > 0 ? Math.round((post_count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.post_count - a.post_count)
    .slice(0, 15);
}

// ─── Entities ────────────────────────────────────────────────────────

export interface EntityBreakdown {
  entity: string;
  mentions: number;
  total_views: number;
  total_likes: number;
}

export function aggregateEntities(posts: DashboardPost[]): EntityBreakdown[] {
  const map = new Map<string, { mentions: number; views: number; likes: number }>();
  for (const p of posts) {
    for (const e of p.entities ?? []) {
      const cur = map.get(e) || { mentions: 0, views: 0, likes: 0 };
      cur.mentions += 1;
      cur.views += p.view_count;
      cur.likes += p.like_count;
      map.set(e, cur);
    }
  }
  return [...map.entries()]
    .map(([entity, v]) => ({
      entity,
      mentions: v.mentions,
      total_views: v.views,
      total_likes: v.likes,
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15);
}

// ─── Content Type ────────────────────────────────────────────────────

export interface ContentTypeBreakdown {
  content_type: string;
  count: number;
  percentage: number;
}

export function aggregateContentTypes(posts: DashboardPost[]): ContentTypeBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const ct = p.content_type || 'unknown';
    counts.set(ct, (counts.get(ct) || 0) + 1);
  }
  const total = posts.length;
  return [...counts.entries()]
    .map(([content_type, count]) => ({
      content_type,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Language ────────────────────────────────────────────────────────

export interface LanguageBreakdown {
  language: string;
  post_count: number;
  percentage: number;
}

export function aggregateLanguages(posts: DashboardPost[]): LanguageBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const lang = p.language || 'unknown';
    counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  const total = posts.length;
  return [...counts.entries()]
    .map(([language, post_count]) => ({
      language,
      post_count,
      percentage: total > 0 ? Math.round((post_count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.post_count - a.post_count);
}

// ─── Volume Over Time ────────────────────────────────────────────────

export interface VolumePoint {
  post_date: string;
  platform: string;
  post_count: number;
}

export type VolumeMetric = 'posts' | 'views';

function localBucketKey(rawTimestamp: string, bucket: 'day' | 'hour'): string | null {
  const d = new Date(rawTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (bucket === 'day') return `${y}-${m}-${day}`;
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}`;
}

export function aggregateVolume(
  posts: DashboardPost[],
  bucket: 'day' | 'hour' = 'day',
  metric: VolumeMetric = 'posts',
): VolumePoint[] {
  const map = new Map<string, number>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = localBucketKey(p.posted_at, bucket);
    if (!date) continue;
    const key = `${date}|${p.platform}`;
    const inc = metric === 'views' ? (p.view_count ?? 0) : 1;
    map.set(key, (map.get(key) || 0) + inc);
  }
  return [...map.entries()]
    .map(([key, post_count]) => {
      const [post_date, platform] = key.split('|');
      return { post_date, platform, post_count };
    })
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
}

// ─── Channels ────────────────────────────────────────────────────────

export interface ChannelBreakdown {
  channel_handle: string;
  platform: string;
  subscribers: number;
  channel_url: string;
  collected_posts: number;
  avg_likes: number;
  avg_views: number;
}

export function aggregateChannels(posts: DashboardPost[]): ChannelBreakdown[] {
  const map = new Map<string, { platform: string; count: number; likes: number; views: number }>();
  for (const p of posts) {
    const handle = p.channel_handle || 'unknown';
    const cur = map.get(handle) || { platform: p.platform, count: 0, likes: 0, views: 0 };
    cur.count += 1;
    cur.likes += p.like_count;
    cur.views += p.view_count;
    map.set(handle, cur);
  }
  return [...map.entries()]
    .map(([channel_handle, v]) => ({
      channel_handle,
      platform: v.platform,
      subscribers: 0,
      channel_url: '',
      collected_posts: v.count,
      avg_likes: v.count > 0 ? Math.round(v.likes / v.count) : 0,
      avg_views: v.count > 0 ? Math.round(v.views / v.count) : 0,
    }))
    .sort((a, b) => b.collected_posts - a.collected_posts)
    .slice(0, 20);
}

// ─── KPIs ────────────────────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: number;
}

export function computeKpis(posts: DashboardPost[], serverKpis?: DashboardKpis): KpiItem[] {
  if (serverKpis) {
    return [
      { label: 'Total Posts', value: serverKpis.total_posts },
      { label: 'Total Views', value: serverKpis.total_views },
      { label: 'Total Likes', value: serverKpis.total_likes },
      { label: 'Total Comments', value: serverKpis.total_comments },
      { label: 'Total Shares', value: serverKpis.total_shares },
    ];
  }
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  for (const p of posts) {
    views += p.view_count;
    likes += p.like_count;
    comments += p.comment_count;
    shares += p.share_count;
  }
  return [
    { label: 'Total Posts', value: posts.length },
    { label: 'Total Views', value: views },
    { label: 'Total Likes', value: likes },
    { label: 'Total Comments', value: comments },
    { label: 'Total Shares', value: shares },
  ];
}

// ─── Sentiment Over Time ────────────────────────────────────────────

export interface SentimentTimePoint {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

export function aggregateSentimentOverTime(
  posts: DashboardPost[],
  bucket: 'day' | 'hour' = 'day',
  metric: VolumeMetric = 'posts',
): SentimentTimePoint[] {
  const map = new Map<string, { positive: number; negative: number; neutral: number; mixed: number }>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = localBucketKey(p.posted_at, bucket);
    if (!date) continue;
    const counts = map.get(date) ?? { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    const inc = metric === 'views' ? (p.view_count ?? 0) : 1;
    const s = (p.sentiment ?? 'neutral').toLowerCase() as keyof typeof counts;
    if (s in counts) counts[s] += inc;
    else counts.neutral += inc;
    map.set(date, counts);
  }
  return [...map.entries()]
    .map(([date, c]) => ({ date, ...c }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Emotions ─────────────────────────────────────────────────────────

export interface EmotionBreakdown {
  emotion: string;
  count: number;
  percentage: number;
}

export function aggregateEmotions(posts: DashboardPost[]): EmotionBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const e = p.emotion || 'unknown';
    if (e === 'unknown') continue;
    counts.set(e, (counts.get(e) || 0) + 1);
  }
  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  return [...counts.entries()]
    .map(([emotion, count]) => ({
      emotion,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ─── Theme Cloud ──────────────────────────────────────────────────────

export interface CloudWord {
  text: string;
  value: number;
}

export function aggregateThemeCloud(posts: DashboardPost[]): CloudWord[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.themes ?? []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([text, value]) => ({ text, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);
}

// ─── Engagement Rate Over Time ────────────────────────────────────────

export interface EngagementRatePoint {
  date: string;
  rate: number;
  total_engagement: number;
  total_views: number;
}

export function aggregateEngagementRate(
  posts: DashboardPost[],
  bucket: 'day' | 'hour' = 'day',
): EngagementRatePoint[] {
  const map = new Map<string, { engagement: number; views: number }>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = localBucketKey(p.posted_at, bucket);
    if (!date) continue;
    const cur = map.get(date) ?? { engagement: 0, views: 0 };
    cur.engagement += p.like_count + p.comment_count + p.share_count;
    cur.views += p.view_count;
    map.set(date, cur);
  }
  return [...map.entries()]
    .map(([date, v]) => ({
      date,
      rate: v.views > 0 ? Math.round((v.engagement / v.views) * 10000) / 100 : 0,
      total_engagement: v.engagement,
      total_views: v.views,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Enhanced KPIs ────────────────────────────────────────────────────

export interface EnhancedKpi {
  label: string;
  value: number;
  icon: 'posts' | 'views' | 'engagement' | 'rate' | 'avg';
  format?: 'number' | 'percent';
  sparklineData: number[];
}

export function computeEnhancedKpis(posts: DashboardPost[], serverKpis?: DashboardKpis): EnhancedKpi[] {
  // Group by date for sparklines
  const byDate = new Map<string, { posts: number; views: number; engagement: number }>();
  let totalViews = 0;
  let totalEngagement = 0;

  for (const p of posts) {
    const date = p.posted_at?.slice(0, 10) ?? 'unknown';
    const cur = byDate.get(date) ?? { posts: 0, views: 0, engagement: 0 };
    cur.posts += 1;
    cur.views += p.view_count;
    const eng = p.like_count + p.comment_count + p.share_count;
    cur.engagement += eng;
    byDate.set(date, cur);
    totalViews += p.view_count;
    totalEngagement += eng;
  }

  // Use server-side KPIs for totals when available (avoids truncation issues)
  if (serverKpis) {
    totalViews = serverKpis.total_views;
    totalEngagement = serverKpis.total_likes + serverKpis.total_comments + serverKpis.total_shares;
  }

  const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // Downsample to max 30 points
  const step = Math.max(1, Math.floor(sorted.length / 30));
  const sampled = sorted.filter((_, i) => i % step === 0);

  const totalPosts = serverKpis?.total_posts ?? posts.length;
  const engagementRate = totalViews > 0 ? Math.round((totalEngagement / totalViews) * 10000) / 100 : 0;
  const avgEngPerPost = totalPosts > 0 ? Math.round(totalEngagement / totalPosts) : 0;

  return [
    {
      label: 'Total Posts',
      value: totalPosts,
      icon: 'posts',
      sparklineData: sampled.map(([, v]) => v.posts),
    },
    {
      label: 'Total Views',
      value: totalViews,
      icon: 'views',
      sparklineData: sampled.map(([, v]) => v.views),
    },
    {
      label: 'Total Engagement',
      value: totalEngagement,
      icon: 'engagement',
      sparklineData: sampled.map(([, v]) => v.engagement),
    },
    {
      label: 'Engagement Rate',
      value: engagementRate,
      icon: 'rate',
      format: 'percent',
      sparklineData: sampled.map(([, v]) => v.views > 0 ? (v.engagement / v.views) * 100 : 0),
    },
    {
      label: 'Avg Eng / Post',
      value: avgEngPerPost,
      icon: 'avg',
      sparklineData: sampled.map(([, v]) => v.posts > 0 ? v.engagement / v.posts : 0),
    },
  ];
}

// ─── Custom chart aggregation ──────────────────────────────────────────────────

export function getMetricValue(p: DashboardPost, metric: CustomMetric): number {
  switch (metric) {
    case 'post_count':       return 1;
    case 'like_count':       return p.like_count;
    case 'view_count':       return p.view_count;
    case 'comment_count':    return p.comment_count;
    case 'share_count':      return p.share_count;
    case 'engagement_total': return p.like_count + p.comment_count + p.share_count;
    // `customobj:` element tokens are resolved by the object aggregator, not here.
    default:
      // Per-post computed metric (if/else → numeric). The value is attached by
      // the server transform under `post.computed[id]`. Expr metrics are NOT
      // attached (aggregate-then-evaluate) and are handled upstream by
      // `aggregateComputedExpr`, never here.
      if (isComputedRef(metric)) {
        const v = p.computed?.[computedFieldId(metric)];
        return typeof v === 'number' ? v : Number(v ?? 0) || 0;
      }
      return 0;
  }
}

export function bucketDate(dateStr: string, timeBucket: NonNullable<CustomChartConfig['timeBucket']>): string {
  if (!dateStr) return 'unknown';
  if (timeBucket === 'hour') {
    // ISO-8601 hour resolution: YYYY-MM-DDTHH:00:00 (local), kept parseable by `new Date`.
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    return `${y}-${mo}-${da}T${h}:00:00`;
  }
  if (timeBucket === 'day') return dateStr.slice(0, 10);
  if (timeBucket === 'week') {
    // Compute the week's Monday in UTC off the calendar day only (no
    // time-of-day, no local-tz drift), so every post in the same ISO week
    // collapses to one key. Mixing local date math with toISOString() here
    // used to fragment a week into 2 keys in non-UTC timezones.
    const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const toMonday = (day === 0 ? -6 : 1) - day;
    d.setUTCDate(d.getUTCDate() + toMonday);
    return d.toISOString().slice(0, 10);
  }
  // month - calendar month from the UTC date string (tz-stable, matches day)
  return dateStr.slice(0, 7);
}

export function getDimensionKeys(p: DashboardPost, dim: CustomDimension, timeBucket: string): string[] {
  // Report-level computed dimension (if/else → categorical). The value is
  // attached by the server transform under `post.computed[id]`.
  if (isComputedRef(dim)) {
    const v = p.computed?.[computedFieldId(dim)];
    return [v == null ? 'unknown' : String(v)];
  }
  if (dim === 'themes') return p.themes?.length ? p.themes : [];
  if (dim === 'entities') return p.entities?.length ? p.entities : [];
  if (dim === 'brands') return p.detected_brands?.length ? p.detected_brands : [];
  if (dim === 'posted_at') return [bucketDate(p.posted_at ?? '', timeBucket as NonNullable<CustomChartConfig['timeBucket']>)];
  if (isCustomFieldDimension(dim)) {
    const raw = p.custom_fields?.[customFieldName(dim)];
    if (raw == null) return [];
    // Skip object values: a `list[object]` field has no scalar key here (it
    // aggregates element-as-unit via aggregateObjectList). Stringifying one
    // would yield "[object Object]".
    if (Array.isArray(raw)) {
      return raw.filter((v) => v != null && typeof v !== 'object').map((v) => String(v));
    }
    if (typeof raw === 'object') return [];
    return [String(raw)];
  }
  const key = (p as unknown as Record<string, unknown>)[dim] as string ?? 'unknown';
  return [key];
}

type Stats = { sum: number; count: number; min: number; max: number };

function resolveAgg(s: Stats, metricAgg: string): number {
  switch (metricAgg) {
    case 'avg': return s.count > 0 ? Math.round(s.sum / s.count) : 0;
    case 'min': return s.min === Infinity ? 0 : s.min;
    case 'max': return s.max === -Infinity ? 0 : s.max;
    case 'count': return s.count;
    default: return s.sum;
  }
}

function addToStats(map: Map<string, Stats>, key: string, val: number) {
  const cur = map.get(key) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity };
  cur.sum += val;
  cur.count += 1;
  cur.min = Math.min(cur.min, val);
  cur.max = Math.max(cur.max, val);
  map.set(key, cur);
}

/** Sum two Stats together - used to merge tail categories into an "Others" bucket. */
function mergeStats(a: Stats, b: Stats): Stats {
  return {
    sum: a.sum + b.sum,
    count: a.count + b.count,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
  };
}

/** Default limit when topN is unset. Prevents pathological cardinality from
 *  hanging the chart. */
const DEFAULT_TOP_N = 50;
/** Default limit on breakdown series count when topN is unset on a 2D config. */
const DEFAULT_BREAKDOWN_LIMIT = 10;

/** Aggregate-then-evaluate path for an `expr` computed metric. Each referenced
 *  leaf metric is summed per bucket, then the expression is evaluated over those
 *  per-bucket sums (so `engagement/views` becomes SUM(engagement)/SUM(views) — a
 *  correct weighted ratio, never an average of per-post ratios). Buckets whose
 *  expression evaluates to null (e.g. divide-by-zero) are EXCLUDED, never shown
 *  as 0. Mirrors the server (api/services/report_transform.py). Breakdown/2D
 *  pivots are not supported for expr metrics in v1 — the breakdown is ignored. */
function aggregateExprMetric(
  posts: DashboardPost[],
  config: CustomChartConfig,
  field: Extract<ComputedField, { kind: 'expr' }>,
): WidgetData {
  const dimension = config.dimension as CustomDimension | undefined;
  const { timeBucket = 'day', topN, includeOthers, cumulative } = config;
  const leaves = exprLeafRefs(field.expr).map((m) => m as CustomMetric);
  const label = field.name;

  const blankSums = (): Record<string, number> => {
    const s: Record<string, number> = {};
    for (const leaf of leaves) s[leaf] = 0;
    return s;
  };
  const addPost = (sums: Record<string, number>, p: DashboardPost) => {
    for (const leaf of leaves) sums[leaf] += getMetricValue(p, leaf);
  };

  // Number-card (no dimension): one set of sums over all posts.
  if (!dimension) {
    const sums = blankSums();
    for (const p of posts) addPost(sums, p);
    const v = evaluateExpr(field.expr, sums) ?? 0;
    return { value: v, labels: [label], values: [v] };
  }

  // Per-bucket leaf sums.
  const acc = new Map<string, Record<string, number>>();
  for (const p of posts) {
    for (const key of getDimensionKeys(p, dimension, timeBucket)) {
      let bucket = acc.get(key);
      if (!bucket) { bucket = blankSums(); acc.set(key, bucket); }
      addPost(bucket, p);
    }
  }

  // Time series: chronological, no topN/Others. Null buckets are dropped.
  if (dimension === 'posted_at') {
    const resolved = [...acc.entries()]
      .map(([labelKey, sums]) => ({ label: labelKey, value: evaluateExpr(field.expr, sums) }))
      .filter((e): e is { label: string; value: number } => e.value !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
    const seriesValues = cumulative
      ? toCumulativeSeries(resolved.map((r) => r.value))
      : resolved.map((r) => r.value);
    const total = seriesValues.reduce((s, v) => s + v, 0);
    return {
      value: total,
      labels: resolved.map((r) => r.label),
      values: seriesValues,
      timeSeries: resolved.map((r, i) => ({ date: r.label, value: seriesValues[i] })),
    };
  }

  // Categorical: evaluate per bucket, drop nulls, sort desc, topN + Others.
  const ranked = [...acc.entries()]
    .map(([labelKey, sums]) => ({ label: labelKey, sums, value: evaluateExpr(field.expr, sums) }))
    .filter((r): r is { label: string; sums: Record<string, number>; value: number } => r.value !== null)
    .sort((a, b) => b.value - a.value);

  const limit = topN ?? DEFAULT_TOP_N;
  const top = ranked.slice(0, limit);
  const tail = ranked.slice(limit);
  const labels = top.map((r) => r.label);
  const values = top.map((r) => r.value);

  if (includeOthers && tail.length > 0) {
    const merged = blankSums();
    for (const r of tail) for (const leaf of leaves) merged[leaf] += r.sums[leaf];
    const v = evaluateExpr(field.expr, merged);
    if (v !== null) { labels.push('Others'); values.push(v); }
  }

  const total = values.reduce((s, v) => s + v, 0);
  return { value: total, labels, values };
}

export function aggregateCustom(
  posts: DashboardPost[],
  config: CustomChartConfig,
  computedFields?: ComputedField[],
): WidgetData {
  // An `expr` computed metric is aggregate-then-evaluate: it can't go through
  // the per-post `getMetricValue` path (that would force per-post-then-aggregate
  // and break ratios). Route it to `aggregateExprMetric`. An if/else computed
  // metric is per-post (its value is attached as `post.computed[id]`), so it
  // falls through to the normal path below.
  if (config.metric && isComputedRef(config.metric)) {
    const cf = computedFields?.find((f) => f.id === computedFieldId(config.metric as `computed:${string}`));
    if (cf?.kind === 'expr') return aggregateExprMetric(posts, config, cf);
  }

  // CustomChartConfig.dimension/metric are widened to AnyDimension/AnyMetric
  // to carry topic widgets through the same shape. This aggregator is the
  // post-side path - only invoked when widget.dataSource === 'posts'. The
  // caller guarantees these narrow to the post-side vocabulary; cast at the
  // boundary so internal helpers can keep their narrow signatures.
  const dimension = config.dimension as CustomDimension | undefined;
  const breakdownDimension = config.breakdownDimension as CustomDimension | undefined;
  const metric = config.metric as CustomMetric;
  const { metricAgg = 'sum', timeBucket = 'day', topN, includeOthers, cumulative } = config;

  if (!dimension) {
    if (metricAgg === 'count') return { value: posts.length, labels: ['Count'], values: [posts.length] };
    const vals = posts.map((p) => getMetricValue(p, metric));
    let value: number;
    switch (metricAgg) {
      case 'avg': value = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0; break;
      case 'min': value = vals.length > 0 ? Math.min(...vals) : 0; break;
      case 'max': value = vals.length > 0 ? Math.max(...vals) : 0; break;
      default: value = vals.reduce((a, b) => a + b, 0); break;
    }
    return { value, labels: [metric], values: [value] };
  }

  // ── Time series with breakdown → groupedTimeSeries (multi-line) ───────
  if (dimension === 'posted_at' && breakdownDimension && breakdownDimension !== dimension) {
    const acc = new Map<string, Map<string, Stats>>(); // date → breakdownKey → Stats
    const breakdownTotals = new Map<string, number>();

    for (const p of posts) {
      const val = getMetricValue(p, metric);
      const dateKey = bucketDate(p.posted_at ?? '', timeBucket);
      const bKeys = getDimensionKeys(p, breakdownDimension, timeBucket);
      if (!acc.has(dateKey)) acc.set(dateKey, new Map());
      const inner = acc.get(dateKey)!;
      for (const bk of bKeys) {
        addToStats(inner, bk, val);
        breakdownTotals.set(bk, (breakdownTotals.get(bk) ?? 0) + val);
      }
    }

    const allDates = [...acc.keys()].sort();
    const limit = topN ?? DEFAULT_BREAKDOWN_LIMIT;
    const sortedByTotal = [...breakdownTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topKeys = sortedByTotal.slice(0, limit).map(([k]) => k);
    const tailKeys = sortedByTotal.slice(limit).map(([k]) => k);

    // Accumulate a per-series array into a running total in place, preserving
    // the {date} of each point. No-op unless `cumulative` is set.
    const accumulate = (series: Array<{ date: string; value: number }>) => {
      if (!cumulative) return series;
      const running = toCumulativeSeries(series.map((d) => d.value));
      return series.map((d, i) => ({ date: d.date, value: running[i] }));
    };

    const grouped: Record<string, Array<{ date: string; value: number }>> = {};
    for (const bk of topKeys) {
      grouped[bk] = accumulate(allDates.map((date) => {
        const s = acc.get(date)?.get(bk);
        return { date, value: s ? resolveAgg(s, metricAgg) : 0 };
      }));
    }
    if (includeOthers && tailKeys.length > 0) {
      grouped['Others'] = accumulate(allDates.map((date) => {
        let merged: Stats = { sum: 0, count: 0, min: Infinity, max: -Infinity };
        let any = false;
        for (const bk of tailKeys) {
          const s = acc.get(date)?.get(bk);
          if (s) { merged = mergeStats(merged, s); any = true; }
        }
        return { date, value: any ? resolveAgg(merged, metricAgg) : 0 };
      }));
    }

    // When cumulative, each series already holds a running total, so its last
    // point IS that series' true sum - summing every point would over-count.
    let grandTotal = 0;
    for (const series of Object.values(grouped)) {
      if (cumulative) grandTotal += series.length > 0 ? series[series.length - 1].value : 0;
      else for (const p of series) grandTotal += p.value;
    }
    return { value: grandTotal, groupedTimeSeries: grouped };
  }

  // ── Two-dimensional pivot (categorical primary + breakdown) ───────────
  if (breakdownDimension && breakdownDimension !== dimension && dimension !== 'posted_at') {
    const acc2d = new Map<string, Map<string, Stats>>();
    const breakdownTotals = new Map<string, number>();

    for (const p of posts) {
      const val = getMetricValue(p, metric);
      const primaryKeys = getDimensionKeys(p, dimension, timeBucket);
      const bKeys = getDimensionKeys(p, breakdownDimension, timeBucket);
      for (const pk of primaryKeys) {
        if (!acc2d.has(pk)) acc2d.set(pk, new Map());
        const inner = acc2d.get(pk)!;
        for (const bk of bKeys) {
          addToStats(inner, bk, val);
          breakdownTotals.set(bk, (breakdownTotals.get(bk) ?? 0) + val);
        }
      }
    }

    // Primary labels sorted by total value descending, then apply topN/Others
    const primaryRanked = [...acc2d.keys()]
      .map((label) => {
        const inner = acc2d.get(label)!;
        let total = 0;
        for (const s of inner.values()) total += resolveAgg(s, metricAgg);
        return { label, total };
      })
      .sort((a, b) => b.total - a.total);

    const primaryLimit = topN ?? DEFAULT_TOP_N;
    const topPrimary = primaryRanked.slice(0, primaryLimit).map((r) => r.label);
    const tailPrimary = primaryRanked.slice(primaryLimit).map((r) => r.label);

    // Breakdown groups: capped at DEFAULT_BREAKDOWN_LIMIT (legend would be unreadable beyond)
    const topBreakdowns = [...breakdownTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, DEFAULT_BREAKDOWN_LIMIT)
      .map(([k]) => k);

    const primaryLabels = [...topPrimary];
    if (includeOthers && tailPrimary.length > 0) primaryLabels.push('Others');

    const datasets = topBreakdowns.map((bk) => ({
      label: bk,
      values: primaryLabels.map((pk) => {
        if (pk === 'Others') {
          let othersVal = 0;
          for (const tail of tailPrimary) {
            const s = acc2d.get(tail)?.get(bk);
            if (s) othersVal += resolveAgg(s, metricAgg);
          }
          return othersVal;
        }
        const s = acc2d.get(pk)?.get(bk);
        return s ? resolveAgg(s, metricAgg) : 0;
      }),
    }));

    const grandTotal = datasets.reduce((s, ds) => s + ds.values.reduce((a, b) => a + b, 0), 0);

    return {
      value: grandTotal,
      groupedCategorical: { labels: primaryLabels, datasets },
    };
  }

  // ── Single-dimension aggregation ──────────────────────────────────────
  const acc = new Map<string, Stats>();

  for (const p of posts) {
    const val = getMetricValue(p, metric);
    for (const key of getDimensionKeys(p, dimension, timeBucket)) {
      addToStats(acc, key, val);
    }
  }

  if (dimension === 'posted_at') {
    // Time series - natural chronological order, no topN/Others.
    const resolved: Array<{ label: string; value: number }> = [];
    for (const [label, s] of acc) {
      resolved.push({ label, value: resolveAgg(s, metricAgg) });
    }
    resolved.sort((a, b) => a.label.localeCompare(b.label));
    const total = resolved.reduce((s, r) => s + r.value, 0);
    const seriesValues = cumulative
      ? toCumulativeSeries(resolved.map((r) => r.value))
      : resolved.map((r) => r.value);
    return {
      value: total,
      labels: resolved.map((r) => r.label),
      values: seriesValues,
      timeSeries: resolved.map((r, i) => ({ date: r.label, value: seriesValues[i] })),
    };
  }

  // Categorical: apply topN + optional Others bucket
  const ranked: Array<{ label: string; stats: Stats; value: number }> = [];
  for (const [label, s] of acc) {
    ranked.push({ label, stats: s, value: resolveAgg(s, metricAgg) });
  }
  ranked.sort((a, b) => b.value - a.value);

  const limit = topN ?? DEFAULT_TOP_N;
  const top = ranked.slice(0, limit);
  const tail = ranked.slice(limit);

  const labels = top.map((r) => r.label);
  const values = top.map((r) => r.value);

  if (includeOthers && tail.length > 0) {
    let merged: Stats = { sum: 0, count: 0, min: Infinity, max: -Infinity };
    for (const r of tail) merged = mergeStats(merged, r.stats);
    labels.push('Others');
    values.push(resolveAgg(merged, metricAgg));
  }

  const total = values.reduce((s, v) => s + v, 0);
  return { value: total, labels, values };
}

// ─── Post-field value extraction (post-mode tables) ─────────────────────────

/** Read a raw post field for a post-mode table cell. Returns the value typed
 *  for direct rendering: numbers for counts, strings for text/badges/links,
 *  string[] for chip arrays, or undefined when the field is missing. */
function getPostFieldValue(p: DashboardPost, field: PostField): number | string | string[] | undefined {
  switch (field) {
    case 'post_url':         return p.post_url ?? '';
    case 'posted_at':        return p.posted_at;
    case 'platform':         return p.platform;
    case 'channel_handle':   return p.channel_handle;
    case 'channel_type':     return p.channel_type;
    case 'title':            return p.title;
    case 'content':          return p.content;
    case 'ai_summary':       return p.ai_summary;
    case 'language':         return p.language;
    case 'content_type':     return p.content_type;
    case 'sentiment':        return p.sentiment;
    case 'emotion':          return p.emotion;
    case 'themes':           return p.themes ?? [];
    case 'entities':         return p.entities ?? [];
    case 'brands':           return p.detected_brands ?? [];
    case 'like_count':       return p.like_count;
    case 'view_count':       return p.view_count;
    case 'comment_count':    return p.comment_count;
    case 'share_count':      return p.share_count;
    case 'engagement_total': return p.like_count + p.comment_count + p.share_count;
  }
  if (isCustomPostField(field)) {
    const raw = p.custom_fields?.[customFieldName(field)];
    if (raw == null) return undefined;
    if (Array.isArray(raw)) return raw.filter((v) => v != null).map((v) => String(v));
    if (typeof raw === 'number') return raw;
    return String(raw);
  }
  return undefined;
}

/** Comparable sort key for a post-field value. Arrays compare by length;
 *  undefined/empty sort last in desc, first in asc. */
function postFieldSortValue(v: number | string | string[] | undefined): number | string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.length;
  return v;
}

/** Post-mode: one row per post, columns read raw post fields. No grouping,
 *  no metric aggregation; sort by selected col then slice to rowLimit. */
function aggregateTablePostMode(posts: DashboardPost[], config: CustomTableConfig): TableRow[] {
  const { columns, sortBy, sortDir = 'desc', rowLimit = 50 } = config;
  const rows: TableRow[] = posts.map((p) => {
    const row: TableRow = { __key: p.post_id, __platform: p.platform };
    for (const col of columns) {
      if (!isPostFieldColumn(col) || !col.postField) continue;
      const v = getPostFieldValue(p, col.postField);
      if (v !== undefined) row[col.id] = v;
    }
    return row;
  });

  const sortKey = sortBy ?? columns[0]?.id;
  if (sortKey) {
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = postFieldSortValue(a[sortKey]);
      const bv = postFieldSortValue(b[sortKey]);
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return dir * (Number(av ?? 0) - Number(bv ?? 0));
    });
  }
  return rows.slice(0, rowLimit);
}

// ─── Table aggregation ────────────────────────────────────────────────────────

export interface TableRow {
  /** Stable key for React + sort. Compound key joining all group-by dimension
   *  values (one row = one cross-product cell); or post_id in post mode. */
  __key: string;
  /** Platform attached to channel rows so the dimension cell can render a
   *  platform icon. Set when one of the group-by dimensions is `channel_handle`,
   *  or always in post mode. */
  __platform?: string;
  /** Per-column resolved values, keyed by TableColumn.id. Dimension columns
   *  hold the row's dimension value (string); metric columns hold the agg.
   *  Post-field columns hold the raw value - strings, numbers, or arrays. */
  [columnId: string]: number | string | string[] | undefined;
}

const COMPOUND_SEP = '';

/** Cross-product key for a post across multiple dimensions. Returns one or
 *  more compound keys: e.g. dims = [platform, sentiment] and a post on
 *  twitter with two themes → 1 compound key (platform single-valued); but
 *  dims = [themes, sentiment] over a post with 2 themes → 2 compound keys.
 *  Each compound key carries its component values so we can populate dim
 *  columns without re-extracting. */
function compoundDimensionKeys(
  p: DashboardPost,
  dimCols: TableColumn[],
): Array<{ key: string; values: string[] }> {
  if (dimCols.length === 0) return [{ key: '__all__', values: [] }];
  let combos: Array<{ key: string; values: string[] }> = [{ key: '', values: [] }];
  for (const col of dimCols) {
    if (!col.dimension) continue;
    // TableColumn.dimension is widened to AnyDimension for topic-table reuse.
    // aggregateTable is the post-side path - cast back to CustomDimension.
    const vs = getDimensionKeys(p, col.dimension as CustomDimension, 'day');
    if (vs.length === 0) return [];
    const next: Array<{ key: string; values: string[] }> = [];
    for (const combo of combos) {
      for (const v of vs) {
        next.push({
          key: combo.key === '' ? v : `${combo.key}${COMPOUND_SEP}${v}`,
          values: [...combo.values, v],
        });
      }
    }
    combos = next;
  }
  return combos;
}

/** Multi-column aggregation: rows keyed by the cross product of all dimension
 *  columns; each metric column resolved against its own metric + agg. Single
 *  pass over posts; reuses the same metric extractor as `aggregateCustom` so
 *  chart and table widgets agree on numbers. */
export function aggregateTable(posts: DashboardPost[], rawConfig: CustomTableConfig): TableRow[] {
  const config = normalizeTableConfig(rawConfig);
  if (config.mode === 'post') return aggregateTablePostMode(posts, config);
  const { columns, sortBy, sortDir = 'desc', rowLimit = 25 } = config;
  const dimCols = columns.filter(isDimensionColumn);
  const channelDimCol = dimCols.find((c) => c.dimension === 'channel_handle');

  // compound key -> per-metric-column Stats
  const metricAcc = new Map<string, Map<string, Stats>>();
  // compound key -> dim values (parallel to dimCols)
  const dimValuesOf = new Map<string, string[]>();
  const platformOf = new Map<string, string>();

  for (const p of posts) {
    const combos = compoundDimensionKeys(p, dimCols);
    for (const { key, values } of combos) {
      let perMetric = metricAcc.get(key);
      if (!perMetric) {
        perMetric = new Map();
        metricAcc.set(key, perMetric);
        dimValuesOf.set(key, values);
      }
      for (const col of columns) {
        if (isDimensionColumn(col)) continue;
        // TableColumn.metric is widened to AnyMetric for topic-table reuse.
        // aggregateTable is the post-side path - cast to CustomMetric.
        if (col.metric) addToStats(perMetric, col.id, getMetricValue(p, col.metric as CustomMetric));
      }
      if (channelDimCol && p.platform && !platformOf.has(key)) {
        platformOf.set(key, p.platform);
      }
    }
  }

  const rows: TableRow[] = [];
  for (const [key, perMetric] of metricAcc) {
    const row: TableRow = { __key: key };
    if (platformOf.has(key)) row.__platform = platformOf.get(key);
    const dimValues = dimValuesOf.get(key) ?? [];
    let dimIdx = 0;
    for (const col of columns) {
      if (isDimensionColumn(col)) {
        row[col.id] = dimValues[dimIdx] ?? '';
        dimIdx += 1;
      } else if (col.metric) {
        const stats = perMetric.get(col.id) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity };
        const agg = col.metric === 'post_count' ? 'count' : (col.agg ?? 'sum');
        row[col.id] = resolveAgg(stats, agg);
      }
    }
    rows.push(row);
  }

  const sortKey = sortBy ?? columns[0]?.id;
  if (sortKey) {
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return dir * (Number(av ?? 0) - Number(bv ?? 0));
    });
  }

  return rows.slice(0, rowLimit);
}

/** Per-group breakdown sub-rows for a table's `breakdownDimension`. Returns a
 *  map keyed by the top-level group's compound key (matching `TableRow.__key`
 *  from {@link aggregateTable}); each value is the group's rows re-aggregated by
 *  the breakdown dimension, carrying the table's metric columns under the same
 *  column ids (so the same renderers/formatting apply). The breakdown value
 *  lands under the synthetic `__bd` column id. Opt-in: empty map when no
 *  `breakdownDimension` (or post mode), so callers can no-op cheaply. */
export const BREAKDOWN_DIM_ID = '__bd';

export function aggregateTableBreakdown(
  posts: DashboardPost[],
  rawConfig: CustomTableConfig,
): Map<string, TableRow[]> {
  const config = normalizeTableConfig(rawConfig);
  const result = new Map<string, TableRow[]>();
  const bd = config.breakdownDimension;
  if (!bd || config.mode === 'post') return result;

  const { columns, sortBy, sortDir = 'desc' } = config;
  const dimCols = columns.filter(isDimensionColumn);
  const metricCols = columns.filter((c) => !isDimensionColumn(c) && c.metric);
  if (metricCols.length === 0) return result;

  // groupKey -> breakdownValue -> (metric column id -> Stats)
  const acc = new Map<string, Map<string, Map<string, Stats>>>();
  for (const p of posts) {
    const bdKeys = getDimensionKeys(p, bd, 'day');
    if (bdKeys.length === 0) continue;
    const groupCombos = compoundDimensionKeys(p, dimCols);
    for (const { key: gkey } of groupCombos) {
      let byBd = acc.get(gkey);
      if (!byBd) { byBd = new Map(); acc.set(gkey, byBd); }
      for (const bv of bdKeys) {
        let perMetric = byBd.get(bv);
        if (!perMetric) { perMetric = new Map(); byBd.set(bv, perMetric); }
        for (const col of metricCols) {
          if (col.metric) addToStats(perMetric, col.id, getMetricValue(p, col.metric as CustomMetric));
        }
      }
    }
  }

  const sortKey = sortBy && metricCols.some((c) => c.id === sortBy) ? sortBy : metricCols[0]?.id;
  const dir = sortDir === 'asc' ? 1 : -1;
  for (const [gkey, byBd] of acc) {
    const subRows: TableRow[] = [];
    for (const [bv, perMetric] of byBd) {
      const row: TableRow = { __key: `${gkey}::${bv}`, [BREAKDOWN_DIM_ID]: bv };
      for (const col of metricCols) {
        const stats = perMetric.get(col.id) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity };
        const agg = col.metric === 'post_count' ? 'count' : (col.agg ?? 'sum');
        row[col.id] = resolveAgg(stats, agg);
      }
      subRows.push(row);
    }
    if (sortKey) {
      subRows.sort((a, b) => dir * (Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0)));
    }
    // Cap per-group breakdown rows - this is a drill-down, not a full table.
    result.set(gkey, subRows.slice(0, 8));
  }
  return result;
}
