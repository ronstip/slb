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

export interface UserPreferences {
  email_notifications: boolean;
  data_retention_days: number;
  allow_model_training: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  org_id: string | null;
  org_role: string | null;
  org_name: string | null;
  preferences: UserPreferences | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  is_super_admin?: boolean;
}

export interface OrgMember {
  uid: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  role: string;
}

export interface OrgDetails {
  org_id: string;
  name: string;
  slug: string;
  domain: string | null;
  members: OrgMember[];
  subscription_plan: string | null;
  subscription_status: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
}

export interface OrgInvite {
  invite_id: string;
  email: string;
  role: string;
  status: string;
  invite_code: string;
  created_at: string;
  expires_at: string;
}

export interface SubscriptionInfo {
  status: string | null;
  plan: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_org: boolean;
}

export interface UsageStats {
  period_start: string;
  period_end: string;
  queries_used: number;
  queries_limit: number;
  collections_created: number;
  collections_limit: number;
  posts_collected: number;
  posts_limit: number;
}

export interface UsageTrendPoint {
  date: string;
  queries: number;
  collections: number;
  posts: number;
  user_name?: string;
  user_id?: string;
}

export interface UsageTrendResponse {
  points: UsageTrendPoint[];
  granularity: string;
}

export interface CreditBalance {
  credits_remaining: number;
  credits_used: number;
  credits_total: number;
  is_org: boolean;
}

export interface CreditPack {
  pack_id: string;
  name: string;
  credits: number;
  price_cents: number;
  popular: boolean;
}

export interface CreditPurchaseHistoryItem {
  purchased_at: string;
  credits: number;
  amount_cents: number;
  purchased_by?: string;
  purchased_by_name?: string;
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
  ongoing?: boolean;
  schedule?: string;
}

export interface FeedParams {
  sort?: 'engagement' | 'recent' | 'sentiment' | 'views';
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
  | 'monitoring'
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
  ongoing?: boolean;
  schedule?: string;
  video_params?: {
    fps: number;
    start_offset_sec: number;
    end_offset_sec: number;
  };
  reasoning_level?: string;
  custom_fields?: { name: string; description: string; type: string }[];
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
  visibility?: 'private' | 'org';
  user_id?: string;
  ongoing?: boolean;
  last_run_at?: string;
  next_run_at?: string;
  total_runs?: number;
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
  emotion?: string;
  themes?: string[];
  entities?: string[];
  ai_summary?: string;
  content_type?: string;
  key_quotes?: string[];
  custom_fields?: Record<string, unknown> | null;
  collection_id?: string;
}

export interface FeedResponse {
  posts: FeedPost[];
  total: number;
  offset: number;
  limit: number;
}

export interface MultiFeedParams {
  collection_ids: string[];
  sort?: 'engagement' | 'recent' | 'sentiment' | 'views';
  platform?: string;
  sentiment?: string;
  limit?: number;
  offset?: number;
}

export interface BreakdownItem {
  value: string;
  post_count: number;
  view_count: number;
  like_count: number;
}

export interface CollectionStats {
  computed_at: string | null;
  collection_status_at_compute: 'collecting' | 'completed' | null;
  total_posts: number;
  total_unique_channels: number;
  date_range: { earliest: string | null; latest: string | null };
  platform_breakdown: BreakdownItem[];
  sentiment_breakdown: BreakdownItem[];
  top_themes: BreakdownItem[];
  top_entities: BreakdownItem[];
  language_breakdown: BreakdownItem[];
  content_type_breakdown: BreakdownItem[];
  negative_sentiment_pct: number | null;
  total_posts_enriched: number;
  engagement_summary: {
    total_likes: number;
    total_views: number;
    total_comments: number;
    total_shares: number;
    avg_likes: number;
    avg_views: number;
    avg_comments: number;
    avg_shares: number;
    max_likes: number;
    max_views: number;
    median_likes: number;
    median_views: number;
  };
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
  | { event_type: 'partial_text'; content: string; author?: string }
  | { event_type: 'tool_call'; content: string; metadata: ToolCallMeta; author: string }
  | { event_type: 'tool_result'; content: string; metadata: ToolResultMeta; author: string }
  | { event_type: 'thinking'; content: string; author?: string }
  | { event_type: 'status'; content: string; author?: string }
  | { event_type: 'needs_decision'; content: string; metadata: Record<string, unknown>; author?: string }
  | { event_type: 'finding'; content: string; metadata: Record<string, unknown>; author?: string }
  | { event_type: 'plan'; content: string; metadata: Record<string, unknown>; author?: string }
  | { event_type: 'context_update'; agent_selected_sources: string[]; reason?: string }
  | { event_type: 'done'; session_id: string; session_title?: string; content: string; suggestions?: string[] }
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
  subscribers: number;
  channel_url: string;
  collected_posts: number;
  avg_likes: number;
  avg_views: number;
}

export interface EntityCoOccurrence {
  entity_a: string;
  entity_b: string;
  co_occurrence_count: number;
}

export interface LanguageDistribution {
  language: string;
  post_count: number;
  percentage: number;
}

export interface EntitySummary {
  entity: string;
  mentions: number;
  total_views: number;
  total_likes: number;
}

// ─── Meta-agent communication event payloads ─────────────────────────

export interface DecisionOption {
  label: string;
  description: string;
}

export interface NeedsDecisionPayload {
  question: string;
  options: DecisionOption[];
  context: string;
  impact: 'high' | 'low';
}

export interface FindingPayload {
  summary: string;
  significance: 'notable' | 'surprising' | 'expected';
}

export interface PlanStep {
  description: string;
  tool: string;
}

export interface PlanPayload {
  objective: string;
  steps: PlanStep[];
  estimated_queries: number;
}

// ─── Insight Report types ────────────────────────────────────────────

export type ReportCardType =
  // Report-specific types
  | 'kpi_grid'
  | 'narrative'
  | 'key_finding'
  | 'top_posts_table'
  // Existing chart types (reused)
  | 'sentiment_pie'
  | 'sentiment_bar'
  | 'volume_chart'
  | 'line_chart'
  | 'histogram'
  | 'theme_bar'
  | 'platform_bar'
  | 'content_type_donut'
  | 'language_pie'
  | 'engagement_metrics'
  | 'channel_table'
  | 'entity_table';

export interface ReportCard {
  id: string;
  card_type: ReportCardType;
  title?: string;
  data: Record<string, unknown>;
  layout?: {
    width?: 'full' | 'half';
    zone?: 'header' | 'body' | 'footer';
  };
}

export interface KpiItem {
  label: string;
  value: string | number;
  change?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface InsightReportPayload {
  status: string;
  report_id: string;
  title: string;
  collection_ids?: string[];
  collection_names?: string[];
  /** @deprecated Use collection_ids — kept for backward compat */
  collection_id?: string;
  /** @deprecated Use collection_names — kept for backward compat */
  collection_name?: string;
  date_from?: string;
  date_to?: string;
  generated_at: string;
  cards: ReportCard[];
  message?: string;
}

// ─── Tool result types ───────────────────────────────────────────────

export interface DesignResearchResult {
  status: string;
  config: CollectionConfig;
  original_question: string;
  summary: {
    platforms: string[];
    keywords: string[];
    time_range: string;
    estimated_api_calls: number;
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
  emotion: string | null;
  themes: string | null;
  entities: string | null;
  ai_summary: string | null;
  content_type: string | null;
  key_quotes: string[] | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface DataExportResult {
  status: string;
  message: string;
  rows: DataExportRow[];
  row_count: number;
  column_names: string[];
  collection_id?: string;
}

// --- Admin types ---

export interface AdminOverview {
  total_users: number;
  total_orgs: number;
  active_users_30d: number;
  total_queries: number;
  total_collections: number;
  total_posts: number;
  total_revenue_cents: number;
  total_credits_purchased: number;
  credits_outstanding: number;
}

export interface AdminUser {
  uid: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  org_id: string | null;
  org_role: string | null;
  created_at: string;
  last_login_at: string | null;
  queries_used: number;
  collections_created: number;
  posts_collected: number;
  credits_remaining: number;
}

export interface AdminUserList {
  users: AdminUser[];
  total: number;
}

export interface AdminEvent {
  event_id: string;
  event_type: string;
  session_id: string | null;
  collection_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminUserDetail extends AdminUser {
  recent_events: AdminEvent[];
  usage_trend: { date: string; queries: number; collections: number; posts: number }[];
}

export interface AdminActivityPoint {
  date: string;
  event_type: string;
  count: number;
}

export interface AdminActivity {
  points: AdminActivityPoint[];
}

export interface AdminCollection {
  collection_id: string;
  user_id: string;
  user_email: string;
  org_id: string | null;
  original_question: string;
  status: string;
  posts_collected: number;
  posts_enriched: number;
  platforms: string[];
  ongoing: boolean;
  created_at: string;
  error_message: string | null;
}

export interface AdminCollectionList {
  collections: AdminCollection[];
  total: number;
}

export interface AdminRevenue {
  total_revenue_cents: number;
  total_purchases: number;
  avg_purchase_cents: number;
  daily_revenue: { date: string; revenue_cents: number; purchases: number }[];
  recent_purchases: CreditPurchaseHistoryItem[];
}
