import { apiGet } from '../client.ts';

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

// ─── Layout ─────────────────────────────────────────────────────────

export interface BriefingLayout {
  generated_at: string;
  editors_note: string | null;
  hero: Story;
  secondary: Story[];
  rail: Story[];
  pulse?: BriefingPulse;
}

export function getAgentBriefing(agentId: string): Promise<BriefingLayout> {
  return apiGet<BriefingLayout>(`/agents/${agentId}/briefing`);
}
