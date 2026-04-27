import { apiDelete, apiGet, apiPost } from '../client.ts';
import type { BriefingMetaResponse, BriefingShareInfo } from '../types.ts';

// ─── Building blocks ────────────────────────────────────────────────

export interface MetricItem {
  label: string;
  value: string;
  delta?: string | null;
  tone?: 'positive' | 'negative' | 'neutral' | null;
}

export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'table';

export interface ChartSpec {
  chart_type: ChartType;
  data: Record<string, unknown>;
  title?: string | null;
}

export interface TopicStats {
  post_count: number;
  total_views: number;
  total_likes: number;
  avg_views: number;
  positive_pct: number | null;
  negative_pct: number | null;
  earliest_post: string | null;
  latest_post: string | null;
}

// ─── Stories (discriminated union on `type`) ────────────────────────

export interface TopicStory {
  type: 'topic';
  topic_id: string;
  headline: string;
  blurb: string;
  rank: number;
  section_label?: string | null;
  // Server-resolved for topic stories:
  topic_name?: string | null;
  stats?: TopicStats;
  // Hero-only (resolved to cluster-best image):
  image_gcs_uri?: string | null;
  image_original_url?: string | null;
  // Secondary/rail thumbnail:
  thumbnail_gcs_uri?: string | null;
  thumbnail_original_url?: string | null;
}

export interface DataStory {
  type: 'data';
  headline: string;
  blurb: string;
  rank: number;
  section_label?: string | null;
  metrics: MetricItem[];
  chart?: ChartSpec | null;
  timeframe?: string | null;
  citations?: string[];
}

export type Story = TopicStory | DataStory;

// ─── Pulse (aggregate strip) ────────────────────────────────────────

export interface BriefingPulse {
  total_posts: number;
  total_views: number;
  topic_count: number;
  sentiment: {
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
    mixed_pct: number;
  };
  posts_per_day?: number[];
}

// ─── Analytics block (server-computed) ──────────────────────────────

export interface AnalyticsTopPlatform {
  name: string;
  post_count: number;
  share_pct: number;
}

export interface AnalyticsTopChannel {
  handle: string;
  platform?: string | null;
  post_count: number;
  total_views: number;
}

export interface AnalyticsTopPost {
  title: string;
  views: number;
  platform?: string | null;
  channel?: string | null;
}

export interface AnalyticsPeakDay {
  day: string;
  post_count: number;
}

export interface AnalyticsMetrics {
  top_platform?: AnalyticsTopPlatform | null;
  top_channel?: AnalyticsTopChannel | null;
  avg_interactions_per_post: number;
  peak_day?: AnalyticsPeakDay | null;
  top_post?: AnalyticsTopPost | null;
}

export interface AnalyticsPlatformShare {
  name: string;
  post_count: number;
  share_pct: number;
}

export interface AnalyticsSentimentDay {
  day: string;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

export interface BriefingAnalytics {
  metrics: AnalyticsMetrics;
  platform_mix: AnalyticsPlatformShare[];
  sentiment_trend: AnalyticsSentimentDay[];
}

// ─── Layout ─────────────────────────────────────────────────────────

export interface BriefingLayout {
  generated_at: string;
  editors_note: string | null;
  hero: Story;
  secondary: Story[];
  rail: Story[];
  pulse?: BriefingPulse;
  analytics?: BriefingAnalytics | null;
}

// ─── Briefing existence (auth, owner-only metadata) ─────────────────

export function getBriefingMeta(agentId: string): Promise<BriefingMetaResponse> {
  return apiGet<BriefingMetaResponse>(`/agents/${agentId}/briefing/meta`);
}

// ─── Briefing sharing ───────────────────────────────────────────────

export interface SharedBriefingResponse {
  layout: BriefingLayout;
  meta: { title: string; created_at: string };
}

export function getBriefingShare(
  agentId: string,
): Promise<BriefingShareInfo | null> {
  return apiGet<BriefingShareInfo | null>(`/briefing/shares/${agentId}`);
}

export function createBriefingShare(payload: {
  agent_id: string;
  title: string;
}): Promise<BriefingShareInfo> {
  return apiPost('/briefing/shares', payload);
}

export async function revokeBriefingShare(token: string): Promise<void> {
  await apiDelete(`/briefing/shares/${token}`);
}

export async function getPublicBriefing(
  token: string,
): Promise<SharedBriefingResponse> {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${API_BASE}/briefing/shares/public/${token}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
