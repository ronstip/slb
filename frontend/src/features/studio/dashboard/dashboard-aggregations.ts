import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { CustomChartConfig, CustomDimension, WidgetData } from './types-social-dashboard.ts';
import { isCustomFieldDimension, customFieldName } from './types-social-dashboard.ts';

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
}

export function aggregatePlatforms(posts: DashboardPost[]): PlatformBreakdown[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    counts.set(p.platform, (counts.get(p.platform) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([platform, post_count]) => ({ platform, post_count }))
    .sort((a, b) => b.post_count - a.post_count);
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

export function aggregateVolume(posts: DashboardPost[]): VolumePoint[] {
  const map = new Map<string, number>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = p.posted_at.slice(0, 10); // YYYY-MM-DD
    const key = `${date}|${p.platform}`;
    map.set(key, (map.get(key) || 0) + 1);
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

export function aggregateSentimentOverTime(posts: DashboardPost[]): SentimentTimePoint[] {
  const map = new Map<string, { positive: number; negative: number; neutral: number; mixed: number }>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = p.posted_at.slice(0, 10);
    const bucket = map.get(date) ?? { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    const s = (p.sentiment ?? 'neutral').toLowerCase() as keyof typeof bucket;
    if (s in bucket) bucket[s] += 1;
    else bucket.neutral += 1;
    map.set(date, bucket);
  }
  return [...map.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
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

export function aggregateEngagementRate(posts: DashboardPost[]): EngagementRatePoint[] {
  const map = new Map<string, { engagement: number; views: number }>();
  for (const p of posts) {
    if (!p.posted_at) continue;
    const date = p.posted_at.slice(0, 10);
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

function getMetricValue(p: DashboardPost, metric: CustomChartConfig['metric']): number {
  switch (metric) {
    case 'post_count':       return 1;
    case 'like_count':       return p.like_count;
    case 'view_count':       return p.view_count;
    case 'comment_count':    return p.comment_count;
    case 'share_count':      return p.share_count;
    case 'engagement_total': return p.like_count + p.comment_count + p.share_count;
  }
}

function bucketDate(dateStr: string, timeBucket: NonNullable<CustomChartConfig['timeBucket']>): string {
  if (!dateStr) return 'unknown';
  if (timeBucket === 'day') return dateStr.slice(0, 10);
  const d = new Date(dateStr);
  if (timeBucket === 'week') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  // month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDimensionKeys(p: DashboardPost, dim: CustomDimension, timeBucket: string): string[] {
  if (dim === 'themes') return p.themes?.length ? p.themes : [];
  if (dim === 'entities') return p.entities?.length ? p.entities : [];
  if (dim === 'brands') return p.detected_brands?.length ? p.detected_brands : [];
  if (dim === 'posted_at') return [bucketDate(p.posted_at ?? '', timeBucket as NonNullable<CustomChartConfig['timeBucket']>)];
  if (isCustomFieldDimension(dim)) {
    const raw = p.custom_fields?.[customFieldName(dim)];
    if (raw == null) return [];
    if (Array.isArray(raw)) {
      return raw.filter((v) => v != null).map((v) => String(v));
    }
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

export function aggregateCustom(posts: DashboardPost[], config: CustomChartConfig): WidgetData {
  const { dimension, metric, metricAgg = 'sum', timeBucket = 'day', breakdownDimension } = config;

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

  // ── Two-dimensional pivot (breakdown) ─────────────────────────────────
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

    // Sort primary labels by total value descending
    const primaryLabels = [...acc2d.keys()]
      .map((label) => {
        const inner = acc2d.get(label)!;
        let total = 0;
        for (const s of inner.values()) total += resolveAgg(s, metricAgg);
        return { label, total };
      })
      .sort((a, b) => b.total - a.total)
      .map((r) => r.label);

    // Top 10 breakdown groups by total
    const topBreakdowns = [...breakdownTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);

    const datasets = topBreakdowns.map((bk) => ({
      label: bk,
      values: primaryLabels.map((pk) => {
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

  // ── Single-dimension aggregation (existing logic) ─────────────────────
  const acc = new Map<string, Stats>();

  for (const p of posts) {
    const val = getMetricValue(p, metric);
    for (const key of getDimensionKeys(p, dimension, timeBucket)) {
      addToStats(acc, key, val);
    }
  }

  const resolved: Array<{ label: string; value: number }> = [];
  for (const [label, s] of acc) {
    resolved.push({ label, value: resolveAgg(s, metricAgg) });
  }

  const total = resolved.reduce((s, r) => s + r.value, 0);

  if (dimension === 'posted_at') {
    resolved.sort((a, b) => a.label.localeCompare(b.label));
    return {
      value: total,
      labels: resolved.map((r) => r.label),
      values: resolved.map((r) => r.value),
      timeSeries: resolved.map((r) => ({ date: r.label, value: r.value })),
    };
  }

  resolved.sort((a, b) => b.value - a.value);
  return { value: total, labels: resolved.map((r) => r.label), values: resolved.map((r) => r.value) };
}
