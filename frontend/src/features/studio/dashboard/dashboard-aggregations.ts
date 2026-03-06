import type { DashboardPost } from '../../../api/types.ts';

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

export function computeKpis(posts: DashboardPost[]): KpiItem[] {
  let views = 0;
  let likes = 0;
  let comments = 0;
  for (const p of posts) {
    views += p.view_count;
    likes += p.like_count;
    comments += p.comment_count;
  }
  return [
    { label: 'Total Posts', value: posts.length },
    { label: 'Total Views', value: views },
    { label: 'Total Likes', value: likes },
    { label: 'Total Comments', value: comments },
  ];
}
