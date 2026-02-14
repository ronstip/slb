// ============================================================
// API Request & Response Types
// This is the typed boundary between frontend and backend.
// ============================================================

// --- Requests ---

export interface ChatRequest {
  message: string;
  session_id?: string;
  selected_sources?: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string | null;
  org_id: string | null;
  org_role: string | null;
  org_name: string | null;
}

export interface CreateCollectionRequest {
  description: string;
  platforms: string[];
  keywords: string[];
  channel_urls?: string[];
  time_range_days: number;
  geo_scope: string;
  max_calls: number;
  include_comments: boolean;
}

export interface FeedParams {
  sort?: 'engagement' | 'recent' | 'sentiment';
  platform?: string;
  sentiment?: string;
  limit?: number;
  offset?: number;
}

// --- Responses ---

export type CollectionStatus =
  | 'pending'
  | 'collecting'
  | 'enriching'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CollectionConfig {
  platforms: string[];
  keywords: string[];
  channel_urls: string[];
  time_range: { start: string; end: string };
  max_calls: number;
  include_comments: boolean;
  geo_scope: string;
  video_params?: {
    fps: number;
    start_offset_sec: number;
    end_offset_sec: number;
  };
  reasoning_level?: string;
}

export interface CollectionStatusResponse {
  collection_id: string;
  status: CollectionStatus;
  posts_collected: number;
  posts_enriched: number;
  posts_embedded: number;
  error_message?: string;
  config?: CollectionConfig;
  created_at?: string;
}

export interface MediaRef {
  media_type: 'image' | 'video';
  content_type: string;
  original_url: string;
  gcs_uri?: string;
  size_bytes?: number;
}

export interface FeedPost {
  post_id: string;
  platform: string;
  channel_handle: string;
  channel_id?: string;
  title?: string;
  content?: string;
  post_url: string;
  posted_at: string;
  post_type: string;
  media_refs?: MediaRef[];
  likes?: number;
  shares?: number;
  views?: number;
  comments_count?: number;
  saves?: number;
  total_engagement: number;
  sentiment?: string;
  themes?: string[];
  entities?: string[];
  ai_summary?: string;
  content_type?: string;
}

export interface FeedResponse {
  posts: FeedPost[];
  total: number;
  offset: number;
  limit: number;
}

// --- SSE Events ---

export interface ToolCallMeta {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultMeta {
  name: string;
  result?: Record<string, unknown>;
}

export type SSEEvent =
  | { event_type: 'text'; content: string; author: string }
  | { event_type: 'tool_call'; content: string; metadata: ToolCallMeta; author: string }
  | { event_type: 'tool_result'; content: string; metadata: ToolResultMeta; author: string }
  | { event_type: 'done'; session_id: string; content: string }
  | { event_type: 'error'; content: string };

// --- Insight Data (for charts) ---

export interface SentimentBreakdown {
  sentiment: string;
  count: number;
  percentage: number;
}

export interface VolumeOverTime {
  post_date: string;
  platform: string;
  post_count: number;
}

export interface ThemeDistribution {
  theme: string;
  post_count: number;
  percentage: number;
}

export interface ContentTypeBreakdown {
  content_type: string;
  count: number;
  percentage: number;
}

export interface EngagementSummary {
  platform: string;
  total_posts: number;
  total_likes: number;
  total_shares: number;
  total_views: number;
  total_comments: number;
  avg_likes: number;
  avg_views: number;
  max_likes: number;
  max_views: number;
}

export interface ChannelSummary {
  channel_handle: string;
  platform: string;
  post_count: number;
  total_engagement: number;
}

export interface EntityCoOccurrence {
  entity_a: string;
  entity_b: string;
  co_occurrence_count: number;
}

export interface InsightData {
  quantitative: {
    total_posts: Array<{ platform: string; total_posts: number }>;
    sentiment_breakdown: SentimentBreakdown[];
    volume_over_time: VolumeOverTime[];
    engagement_summary: EngagementSummary[];
    channel_summary: ChannelSummary[];
  };
  qualitative: {
    top_posts: FeedPost[];
    theme_distribution: ThemeDistribution[];
    content_type_breakdown: ContentTypeBreakdown[];
    entity_co_occurrence: EntityCoOccurrence[];
  };
}

export interface InsightResult {
  status: string;
  narrative: string;
  data: InsightData;
  message: string;
}

export interface DesignResearchResult {
  status: string;
  config: CollectionConfig;
  original_question: string;
  summary: {
    platforms: string[];
    keywords: string[];
    time_range: string;
    estimated_posts: number;
    estimated_time_minutes: number;
    include_comments: boolean;
  };
  message: string;
}

export interface DataExportRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title: string | null;
  content: string | null;
  post_url: string;
  posted_at: string;
  post_type: string;
  likes: number | null;
  shares: number | null;
  views: number | null;
  comments_count: number | null;
  saves: number | null;
  total_engagement: number;
  sentiment: string | null;
  themes: string | null;
  entities: string | null;
  ai_summary: string | null;
  content_type: string | null;
}

export interface DataExportResult {
  status: string;
  message: string;
  rows: DataExportRow[];
  row_count: number;
  column_names: string[];
}
