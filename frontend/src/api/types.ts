// ============================================================
// API Request & Response Types
// This is the typed boundary between frontend and backend.
// ============================================================

// --- Requests ---

export type ChatModelKey = 'flash-lite' | 'flash' | 'pro';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export type ChatMode = 'chat' | 'report_editor';

export interface ChatRequest {
  message: string;
  session_id?: string;
  agent_id?: string;  // Active agent - auto-loads context into session
  model?: ChatModelKey;  // omit → backend default ("flash")
  thinking_level?: ThinkingLevel;  // omit → backend default
  search_grounding?: boolean;  // omit → backend default
  is_system?: boolean;
  accent_color?: string;  // hex, e.g. "#4A7C8F" - user's selected accent
  theme?: 'light' | 'dark';  // resolved theme (never "system")
  /** Agent persona. 'chat' (default) = broad analyst. 'report_editor' = the
   *  AI button in the report top bar - co-authors the open dashboard. */
  mode?: ChatMode;
  /** Required when mode='report_editor'. The dashboard_layouts doc id the
   *  agent is scoped to. */
  active_dashboard_id?: string;
}

export interface UserPreferences {
  email_notifications: boolean;
  data_retention_days: number;
  allow_model_training: boolean;
}

export interface ImpersonationInfo {
  real_uid: string;
  real_email: string;
  target_uid: string;
  target_email: string;
  target_display_name: string | null;
}

export type PlanTier = 'blocked' | 'free' | 'trial' | 'paid';

export interface PlanInfo {
  tier: PlanTier;
  trial_expires_at: string | null;
}

/** $ prepaid wallet (USD micros). 1_000_000 micros = $1.00. */
export interface Wallet {
  balance_micros: number;
  total_in_micros: number;
  spent_micros: number;
  progress_pct: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  org_id: string | null;
  org_role: string | null;
  org_name: string | null;
  is_anonymous?: boolean;
  preferences: UserPreferences | null;
  plan: PlanInfo;
  credit: Wallet;
  is_super_admin?: boolean;
  /** Present only when a super admin is viewing the app as another user. */
  impersonation?: ImpersonationInfo;
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

export interface OrgInvitePreview {
  org_name: string;
  invited_email: string;
  role: string;
  inviter_name: string | null;
  inviter_email: string | null;
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
  tier: PlanTier;
  trial_expires_at: string | null;
  balance_micros: number;
  total_in_micros: number;
  spent_micros: number;
  progress_pct: number;
  chats: number;
  collections: number;
  posts: number;
}

/** A preset top-up amount shown in the UI. */
export interface TopUpOption {
  amount_cents: number;
  label: string;
  popular: boolean;
}

/** One credit-in ledger entry (grant / purchase / adjustment / refund). */
export interface CreditTransaction {
  id: string;
  kind: string;
  amount_micros: number;
  balance_after_micros: number;
  reason?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface CreateCollectionRequest {
  description: string;
  platforms: string[];
  keywords: string[];
  channel_urls?: string[];
  time_range_days: number;
  geo_scope: string;
  n_posts?: number;
  include_comments: boolean;
  // Enrichment config (optional, set by design_research)
  custom_fields?: { name: string; description: string; type: string }[];
  video_params?: { fps: number; start_offset_sec: number; end_offset_sec: number };
  reasoning_level?: string;
  min_likes?: number;
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
  | 'running'
  | 'success'
  | 'failed';

export interface CollectionConfig {
  platforms: string[];
  keywords: string[];
  channel_urls: string[];
  time_range: { start: string; end: string };
  n_posts?: number;
  include_comments: boolean;
  geo_scope: string;
  video_params?: {
    fps: number;
    start_offset_sec: number;
    end_offset_sec: number;
  };
  reasoning_level?: string;
  min_likes?: number;
  custom_fields?: { name: string; description: string; type: string }[];
}

export interface CollectionStatusResponse {
  collection_id: string;
  status: CollectionStatus;
  posts_collected: number;
  /** Raw provider records before dedup (what we were billed for); null if no run funnel. */
  raw_posts_collected?: number | null;
  posts_enriched: number;
  total_views: number;
  positive_pct: number | null;
  error_message?: string;
  config?: CollectionConfig;
  created_at?: string;
  visibility?: 'private' | 'org';
  user_id?: string;
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
  preview_image_url?: string;
}

export interface FeedPost {
  post_id: string;
  platform: string;
  channel_handle: string;
  channel_id?: string | null;
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
  language?: string;
  custom_fields?: Record<string, unknown> | null;
  context?: string;
  relevance_reason?: string;
  detected_brands?: string[];
  channel_type?: string;
  collection_id?: string;
  is_retweet?: boolean | null;
  is_quote?: boolean | null;
}

export interface FeedKpiBreakdownEntry {
  value: string;
  count: number;
}

/** KPI-strip aggregates computed server-side over the whole filtered window
 *  (independent of the row `limit`). Present only when `include_kpis` was set. */
export interface FeedKpis {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  unique_handles: number;
  platforms: FeedKpiBreakdownEntry[];
  sentiments: FeedKpiBreakdownEntry[];
  top_themes: FeedKpiBreakdownEntry[];
  top_entities: FeedKpiBreakdownEntry[];
}

export interface FeedResponse {
  posts: FeedPost[];
  total: number;
  total_views: number;
  total_sources: number;
  offset: number;
  limit: number;
  kpis?: FeedKpis | null;
}

export interface MultiFeedParams {
  collection_ids: string[];
  sort?: 'engagement' | 'recent' | 'sentiment' | 'views';
  platform?: string;
  sentiment?: string;
  limit?: number;
  offset?: number;
  topic_cluster_id?: string;
  has_media?: boolean;
  dedup?: boolean;
  start_date?: string;
  end_date?: string;
  /** When set, the feed scopes posts via the agent's scope_posts TVF - picks
   *  enrichment rows for this agent (not the latest cross-agent row). */
  agent_id?: string;
  /** Request full-window KPI aggregates alongside the (possibly truncated)
   *  posts. Agent-scoped path only. */
  include_kpis?: boolean;
}

export interface BreakdownItem {
  value: string;
  post_count: number;
  view_count: number;
  like_count: number;
}

export interface CollectionStats {
  computed_at: string | null;
  collection_status_at_compute: 'running' | 'success' | null;
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
  daily_volume?: { post_date: string; platform: string; post_count: number }[];
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

// --- Feed Links ---

export interface FeedLinkInfo {
  token: string;
  title: string;
  collection_ids: string[];
  filters: Record<string, string>;
  created_at: string;
  share_url: string;
  active: boolean;
  access_count: number;
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

// ─── Structured prompt types (ask_user tool) ──────────────────────────

export interface StructuredPromptOption {
  value: string;
  label: string;
  icon?: string;
  description?: string;
  recommended?: boolean;
}

export interface StructuredPrompt {
  id: string;
  type: 'icon_grid' | 'pill_row' | 'tag_input' | 'card_select' | 'toggle_row' | 'approval';
  question: string;
  options?: StructuredPromptOption[];
  multi_select?: boolean;
  preselected?: string[];
  placeholder?: string;
  default_value?: boolean | string;
  allow_other?: boolean;
}

export interface StructuredPromptResult {
  status: 'needs_input';
  prompts: StructuredPrompt[];
  title?: string;
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

// ─── Dashboard types ─────────────────────────────────────────────────

export interface DashboardPost {
  post_id: string;
  collection_id: string;
  platform: string;
  channel_handle: string;
  posted_at: string;
  title?: string;
  content?: string;
  post_url?: string;
  sentiment?: string;
  emotion?: string;
  themes?: string[];
  entities?: string[];
  language?: string;
  content_type?: string;
  custom_fields?: Record<string, unknown> | null;
  ai_summary?: string;
  context?: string;
  relevance_reason?: string;
  detected_brands?: string[];
  channel_type?: string;
  media_refs?: string;
  /** Topic cluster ids this post belongs to (latest clustering run). Powers the
   *  `topics` filter dimension. Empty/absent when unclustered. */
  topic_ids?: string[];
  like_count: number;
  view_count: number;
  comment_count: number;
  share_count: number;
  /** Report-level computed fields, attached by the server transform. Keyed by
   *  computed-field id; only if/else fields are attached per-post (expr metrics
   *  are aggregate-then-evaluate). See report-config-architecture.md. */
  computed?: Record<string, string | number>;
}

export interface DashboardKpis {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
}

export interface TopicBreakdownEntry {
  value: string;
  count: number;
}

export interface TopicPlatformEntry {
  platform: string;
  posts: number;
  views: number;
  likes: number;
  engagement: number;
}

export interface TopicMetric {
  cluster_id: string;
  header?: string | null;
  subheader?: string | null;
  beat_type?: string | null;
  keywords: string[];
  thumbnail_url?: string | null;
  thumbnail_gcs_uri?: string | null;
  top_content_type?: string | null;
  top_emotion?: string | null;
  post_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_engagement: number;
  avg_engagement_per_post: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  mixed_count: number;
  net_sentiment?: number | null;
  recency_score: number;
  signal_score: number;
  sov_posts: number;
  sov_views: number;
  sov_engagement: number;
  estimated_post_count: number;
  estimated_views: number;
  unique_channels: number;
  unique_channels_ugc: number;
  unique_channels_official: number;
  unique_channels_media: number;
  unique_channels_influencers: number;
  earliest_post?: string | null;
  median_post_time?: string | null;
  latest_post?: string | null;
  platforms_breakdown: TopicPlatformEntry[];
  themes_counts: TopicBreakdownEntry[];
  emotion_counts: TopicBreakdownEntry[];
  entities_counts: TopicBreakdownEntry[];
  detected_brands_counts: TopicBreakdownEntry[];
  channel_type_counts: TopicBreakdownEntry[];
  content_type_counts: TopicBreakdownEntry[];
}

export interface DashboardDataResponse {
  posts: DashboardPost[];
  topics?: TopicMetric[];
  collection_names: Record<string, string>;
  truncated: boolean;
  kpis?: DashboardKpis;
}

/** Studio (interactive) server-side aggregation response.
 *  POST /dashboard/aggregate returns compact widget data for all server-
 *  aggregatable widgets. Typed loosely here (same reason as SharedDashboard's
 *  widgetData/tableData). Absent → widget keeps client-side aggregation. */
export interface DashboardAggregateResponse {
  widgetData: Record<string, unknown>;
  tableData: Record<string, unknown>;
  feedData: Record<string, string[]>;
}

export interface DashboardShareInfo {
  token: string;
  dashboard_id: string;
  title: string;
  collection_ids: string[];
  created_at: string;
  share_url: string;
  active: boolean;
}

export interface BriefingShareInfo {
  token: string;
  agent_id: string;
  title: string;
  created_at: string;
  share_url: string;
  active: boolean;
}

export interface ArtifactShareInfo {
  token: string;
  artifact_id: string;
  title: string;
  created_at: string;
  share_url: string;
  active: boolean;
}

export interface BriefingMetaResponse {
  exists: boolean;
  generated_at: string | null;
}

export interface SharedDashboardDataResponse {
  posts: DashboardPost[];
  topics?: TopicMetric[];
  collection_names: Record<string, string>;
  truncated: boolean;
  meta: {
    title: string;
    created_at: string;
  };
  /** Owner's saved widget layout, copied through on the public endpoint so
   *  custom widgets (text cards, custom charts) survive sharing. Typed loosely
   *  here to keep api/types.ts free of feature-layer imports; the consumer
   *  (SharedDashboardPage) casts to `SocialDashboardWidget[]`. */
  layout?: unknown[] | null;
  filterBarFilters?: string[] | null;
  orientation?: 'horizontal' | 'vertical' | null;
  /** The data scope this dashboard's report committed to (if any). Typed
   *  loosely here for the same reason as `layout`; the consumer casts to
   *  `ReportScope`. Absence = standalone dashboard. */
  reportScope?: Record<string, unknown> | null;
  /** Editor toggle: when true, the public viewer should not render the
   *  filter bar at all. */
  filterBarHidden?: boolean | null;
  /** Report-level config. Canonicalization is already applied to `posts`
   *  server-side; value colors + computed-field defs are forwarded for
   *  client-side render. Typed loosely here (cast to `ReportConfig`). */
  reportConfig?: Record<string, unknown> | null;
  /** P2 server-side aggregation (present only with `?agg=server`): widget id →
   *  pre-computed `WidgetData`. The consumer merges these onto the layout
   *  widgets as `serverData`; widgets absent here keep client-side aggregation.
   *  Typed loosely to keep api/types.ts free of feature-layer imports. */
  widgetData?: Record<string, unknown> | null;
  /** P2: widget id → server-computed table rows (`chartType: 'table'`). */
  tableData?: Record<string, unknown> | null;
  /** P2: widget id → ordered post_ids a feed (embeds) widget displays. */
  feedData?: Record<string, string[]> | null;
  /** P2: true when EVERY widget is server-satisfied, so `posts` is only the
   *  bounded feed union (not the full post set). */
  serverComplete?: boolean | null;
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
  emotion: string | null;
  themes: string | null;
  entities: string | null;
  ai_summary: string | null;
  content_type: string | null;
  media_refs?: string | MediaRef[];
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

// --- Topic Clustering types ---

export interface TopicCluster {
  cluster_id: string;
  topic_name: string;
  topic_summary: string;
  topic_keywords: string[];
  post_count: number;
  representative_post_ids: string[];
  algorithm_version: string;
  created_at: string;
  // Summary metrics (enriched by list_topics from BQ)
  positive_count?: number;
  negative_count?: number;
  neutral_count?: number;
  mixed_count?: number;
  total_views?: number;
  total_likes?: number;
  thumbnail_url?: string | null;
  thumbnail_gcs_uri?: string | null;
  platforms?: string[];
  recency_score?: number;
  // llm_taxonomy_v2-only fields. `post_count` above remains the SAMPLED count;
  // when extrapolation ran, `estimated_pool_count` (with CI bounds) is what
  // the UI should show as the headline "how big is this story" number.
  header?: string;
  subheader?: string;
  beat_type?: 'event' | 'narrative' | 'dynamic';
  anchor_entities?: string[];
  anchor_themes?: string[];
  anchor_brands?: string[];
  anchor_content_types?: string[];
  member_post_ids?: string[];
  estimated_pool_count?: number;
  estimated_pool_count_ci_low?: number;
  estimated_pool_count_ci_high?: number;
}

export interface TopicsConfig {
  algorithm_version?: 'brothers_v1' | 'llm_taxonomy_v2';
  window_days?: number;
  sample_size?: number;
  batch_size?: number;
  auto_regenerate_on_pipeline?: boolean;
  last_run_at?: string;
}

export interface TopicsRegenerateResult {
  algorithm_version: string;
  topics_count: number;
  pool_size?: number;
  sample_size?: number;
  candidates_count?: number;
  sample_coverage_pct?: number;
  estimated_pool_count?: number;
  estimated_pool_coverage_pct?: number;
  wall_sec?: number;
  wrote?: boolean;
  error?: string;
}

export interface TopicsNarrative {
  headline: string;
  narrative: string;
  generated_at: string;
  topic_count: number;
}

export interface TopicAnalyticsTotals {
  post_count: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  mixed_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  earliest_post: string | null;
  latest_post: string | null;
}

export interface TopicPlatformBreakdown {
  platform: string;
  post_count: number;
  views: number;
  likes: number;
}

export interface TopicAnalytics {
  totals: TopicAnalyticsTotals;
  platforms: TopicPlatformBreakdown[];
}

export interface TopicPost {
  post_id: string;
  platform: string;
  channel_handle: string;
  channel_id?: string | null;
  channel_name: string | null;
  channel_type?: string | null;
  title: string | null;
  content: string | null;
  post_url: string;
  posted_at: string;
  post_type: string;
  media_refs?: MediaRef[];
  thumbnail_url: string | null;
  thumbnail_gcs_uri?: string | null;
  likes?: number;
  shares?: number;
  views?: number;
  comments_count?: number;
  saves?: number;
  total_engagement: number;
  sentiment: string | null;
  emotion: string | null;
  themes?: string[];
  entities?: string[];
  ai_summary: string | null;
  content_type?: string | null;
  language?: string | null;
  custom_fields?: Record<string, unknown> | null;
  context?: string | null;
  detected_brands?: string[];
  collection_id?: string | null;
  distance_to_centroid: number;
  is_representative: boolean;
}

// --- Admin types ---

export interface AdminOverview {
  total_users: number;
  total_orgs: number;
  active_users_30d: number;
  total_queries: number;
  total_collections: number;
  total_posts: number;
  total_posts_in_range?: number;
  total_posts_related?: number;
  avg_relevancy_pct?: number;
  total_revenue_cents: number;
  total_credits_purchased: number;
  credit_outstanding_micros: number;
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
  tier: PlanTier;
  balance_micros: number;
  /** Spend (billed @ margin) from start of current month. */
  mtd_spend_micros: number;
  /** Spend (billed @ margin) since the user was created. */
  total_spend_micros: number;
}

export interface CostBreakdownItem {
  key: string;
  micros: number;
  events: number;
}

export interface CostBreakdown {
  total_micros: number;
  by_provider: CostBreakdownItem[];
  by_feature: CostBreakdownItem[];
  /** 2-D platform × provider matrix. Each (provider, platform) pair has
   *  its own per-call rate (e.g. Apify charges IG vs FB vs TikTok runs
   *  at different prices), so rolling them into a single "by_provider"
   *  row hides where the cost actually went. */
  by_platform_provider?: PlatformProviderCell[];
}

export interface PlatformProviderCell {
  platform: string;        // 'instagram' | 'facebook' | 'tiktok' | 'x' | 'unspecified' | …
  provider: string;        // 'apify' | 'brightdata' | 'x_api' | 'gemini' | 'unknown' | …
  cost_micros: number;
  billed_micros: number;
  events: number;
}

// --- §E Finance (platform cost vs revenue from usage_events) ---

export interface FinanceItem {
  key: string;
  cost_micros: number;
  revenue_micros: number;
  events: number;
}

export interface FinancePoint {
  date: string;
  cost_micros: number;
  revenue_micros: number;
}

export interface FinanceSummary {
  cost_micros: number;            // total provider cost (all usage, money out)
  revenue_micros: number;         // real cash in - purchases only (excludes grants)
  granted_micros: number;         // admin grants/adjustments issued (NOT revenue)
  net_micros: number;             // revenue − total cost (true P&L)
  usage_billed_micros: number;    // cost × margin across all usage (informational)
  /** Raw cost of usage by super-admins + free/trial accounts (granted, not
   *  purchased credit) - usage WE absorb; reported at cost, no margin. */
  absorbed_cost_micros: number;
  /** Billed (cost × margin) for paid-tier usage only - the only "real
   *  revenue" usage. */
  paid_billed_micros: number;
  /** Sum of users.credit.balance_micros (point-in-time wallet liability). */
  unspent_purchased_micros: number;
  margin_multiplier: number;      // the configured profit factor (the lever)
  events: number;
  by_provider: FinanceItem[];
  by_feature: FinanceItem[];
  by_tier: FinanceItem[];         // revenue_micros here = billed usage value, not cash
  /** Platform × provider matrix - see CostBreakdown.by_platform_provider. */
  by_platform_provider: PlatformProviderCell[];
  /** Group costs by their source ("provider_reported" vs "estimated_fallback"
   *  vs "rate_table") so the admin can see how much of the recorded cost is
   *  an estimate rather than a real provider charge. */
  by_cost_source: FinanceItem[];
  series: FinancePoint[];
}

export interface GeminiModelRate {
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  cached_per_mtok: number | null;
}

/** Curated, admin-editable pricing knobs + global profit margin. */
export interface PricingConfig {
  margin_multiplier: number;
  apify_assumed_per_post_usd: number;
  /** Per-(provider, platform) scraper rate matrix. Each cell is the
   *  effective $/post for that pair. Used as:
   *  - Apify: the fallback estimate when Apify returns no usageTotalUsd.
   *  - BrightData / X_api / Vetric: the authoritative rate (replaces the
   *    legacy single per-record / per-call rate when set).
   *  Cell value `null` means "no override - fall through to '*'". */
  scraper_rates_per_platform: Record<string, Record<string, number | null>>;
  /** Parallel COMMENTS-rate matrix. Same shape as scraper_rates_per_platform.
   *  A cell of `null` means "no comment-specific rate - inherit the posts
   *  rate for that (provider, platform)". */
  scraper_comment_rates_per_platform: Record<string, Record<string, number | null>>;
  /** Parallel CHANNEL-rate matrix (profile/page/subreddit collection). Same
   *  shape; a cell of `null` inherits the posts rate for that (provider,
   *  platform). */
  scraper_channel_rates_per_platform: Record<string, Record<string, number | null>>;
  gemini: Record<string, GeminiModelRate>;
  google_search_gemini3_per_query_usd: number | null;
  google_search_gemini25_per_prompt_usd: number | null;
  brightdata_per_record_usd: number | null;
  x_api_per_unit_usd: number | null;
  vetric_per_call_usd: number | null;
  bq_per_tb_processed_usd: number | null;
  gcs_per_gb_stored_usd: number | null;
  gcs_per_gb_egress_usd: number | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export type PricingUpdate = Partial<Omit<PricingConfig, 'updated_at' | 'updated_by'>>;

/** Admin-editable per-platform provider routing (keyword vs channel). Lets an
 *  admin switch a platform's provider (e.g. IG keyword between hikerapi and
 *  apify) without a redeploy. A value of `null` means "no override - use the
 *  code seed / first-supporting adapter". */
export interface RoutingConfig {
  /** Platforms shown in the editor (display order). */
  platforms: string[];
  /** Selectable vendor tokens (match wrapper._VENDOR_CLASS_MAP keys). */
  vendors: string[];
  keyword_provider_by_platform: Record<string, string | null>;
  channel_provider_by_platform: Record<string, string | null>;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** Partial routing edit: only the platforms touched are sent; `null`/'' clears
 *  a platform's override. */
export interface RoutingUpdate {
  keyword_provider_by_platform?: Record<string, string | null>;
  channel_provider_by_platform?: Record<string, string | null>;
}

export interface AdminAuditEntry {
  id: string;
  event: string;
  actor_email?: string | null;
  occurred_at?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AdminUserList {
  users: AdminUser[];
  total: number;
}

export interface AdminEvent {
  event_id: string;
  event_type: string;
  feature: string | null;
  provider: string | null;
  model: string | null;
  session_id: string | null;
  collection_id: string | null;
  agent_id: string | null;
  cost_micros: number | null;
  billed_micros: number | null;
  created_at: string;
  /** Social platform this row is scoped to (instagram / facebook / tiktok /
   *  x / reddit / youtube). Null for LLM-only events that don't carry a
   *  platform (chat, wizard, topic_cluster). */
  platform: string | null;
  /** "Where cost_micros came from" - see api/services/cost_meter.py
   *  constants. "provider_reported" = Apify's actual usageTotalUsd;
   *  "estimated_fallback" = our assumed_per_post fallback when the
   *  provider went silent; "rate_table" = lookup against config/cost_rates. */
  cost_source: string | null;
}

/** One agent's $ rollup for a single user (admin per-agent attribution). */
export interface AdminAgentCost {
  agent_id: string | null;   // null → bucket of events without an agent_id
  agent_name: string;        // "Unassigned" when agent_id is null
  agent_icon: string | null;
  cost_micros: number;
  billed_micros: number;
  events: number;
  /** Most-recent priced event for this agent (ISO). Drives the Recent
   *  Activity ordering (newest agent first). Null when unknown. */
  last_event_at: string | null;
}

export interface AdminUserDetail extends AdminUser {
  plan: { tier: PlanTier; trial_expires_at: string | null; notes: string };
  credit: Wallet;
  cost_mtd: CostBreakdown;
  cost_all_time: CostBreakdown;
  /** Per-agent cost rollup since this user joined. */
  cost_by_agent_all_time: AdminAgentCost[];
  /** Per-agent cost rollup for the current month. */
  cost_by_agent_mtd: AdminAgentCost[];
  /** Number of agents this user owns. */
  agents_count: number;
  credit_transactions: CreditTransaction[];
  audit_log: AdminAuditEntry[];
  recent_events: AdminEvent[];
  usage_trend: { date: string; cost_micros: number; billed_micros: number }[];
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
  posts_embedded: number;
  posts_stored: number | null;
  posts_in_range?: number;
  posts_unique?: number;
  posts_related?: number;
  relevancy_pct?: number;
  bd_raw_records: number | null;
  platforms: string[];
  created_at: string;
  error_message: string | null;
}

export interface AdminFunnelSummary {
  total_bd_raw_records: number;
  total_bd_error_items: number;
  total_bd_dedup: number;
  total_bd_parse_failures: number;
  total_posts_stored: number;
  total_posts_collected_fs: number;
}

export interface AdminCollectionList {
  collections: AdminCollection[];
  total: number;
  funnel_summary: AdminFunnelSummary;
}

export interface CollectionFunnel {
  bd_raw_records: number;
  bd_error_items_filtered: number;
  bd_cross_keyword_dedup: number;
  bd_parse_failures: number;
  bd_empty_post_id: number;
  bd_valid_posts: number;
  // HikerAPI funnel (absent on audits from before the hiker provider shipped)
  hiker_requests?: number;
  hiker_raw_media?: number;
  hiker_duplicates?: number;
  hiker_parse_failures?: number;
  hiker_valid_posts?: number;
  worker_in_memory_dedup: number;
  worker_bq_dedup: number;
  worker_bq_insert_failures: number;
  worker_posts_stored: number;
  // Stored either way; out-of-range posts just skip enrichment.
  posts_in_range?: number;
  posts_out_of_range?: number;
  per_platform: Record<string, {
    raw_into_parse: number;
    deduped: number;
    parse_failures: number;
    empty_post_id: number;
    valid_posts: number;
  }>;
}

export interface CollectionAudit {
  collection_id: string;
  status: string;
  error_message: string | null;
  posts_collected_firestore: number;
  posts_enriched: number;
  posts_stored_bq: number | null;
  discrepancy_pct: number;
  funnel: CollectionFunnel;
  snapshots: Array<{
    snapshot_id: string;
    collection_id: string;
    dataset_id: string;
    discover_by: string;
    status: string;
    created_at: string;
    downloaded_at?: string;
  }>;
  run_log: {
    collection?: {
      started_at?: string;
      completed_at?: string;
      duration_sec?: number;
      total_dupes_skipped?: number;
      platforms?: Record<string, { posts: number; batches: number; errors: number }>;
      errors?: Array<{ platform: string; error_type: string; message: string }>;
    };
    funnel?: CollectionFunnel;
    recovery?: unknown[];
  };
}

export interface AdminWaitlistEntry {
  id: string;
  email: string;
  display_name?: string | null;
  interested_in?: string | null;
  source?: string | null;
  submission_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminWaitlistList {
  entries: AdminWaitlistEntry[];
  total: number;
}

// --- Wizard planner ---

export type CustomFieldType =
  | 'str' | 'bool' | 'int' | 'float' | 'list[str]' | 'literal' | 'list[object]';

/** Scalar leaf types for the sub-fields of a `list[object]` custom field
 *  (one level deep - no nested lists/objects). */
export type ElementFieldType = 'str' | 'bool' | 'int' | 'float' | 'literal';

export interface ElementFieldDef {
  name: string;
  description: string;
  type: ElementFieldType;
  options?: string[] | null;
}

export interface CustomFieldDef {
  name: string;
  description: string;
  type: CustomFieldType;
  options?: string[] | null;
  /** Required when type === 'list[object]'; the typed sub-fields of each item. */
  element_fields?: ElementFieldDef[] | null;
}

export interface NewCollectionPlan {
  platforms: string[];
  keywords: string[];
  channel_urls: string[];
  time_range_days: number;
  geo_scope: 'global' | 'US' | 'UK' | 'EU' | 'APAC';
  n_posts: number;
}

export interface SchedulePlan {
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  time: string; // "HH:MM" UTC
}

export interface WizardPlan {
  title: string;
  summary: string;
  reasoning: string;
  existing_collection_ids: string[];
  new_collection: NewCollectionPlan | null;
  agent_type: 'one_shot' | 'recurring';
  schedule: SchedulePlan | null;
  outputs?: import('./endpoints/agents.ts').AgentOutput[];
  auto_report: boolean;
  auto_email: boolean;
  auto_slides: boolean;
  custom_fields: CustomFieldDef[];
  enrichment_context: string;
  content_types: string[];
  context?: {
    mission: string;
    world_context: string;
    relevance_boundaries: string;
    analytical_lens: string;
  };
  constitution?: {
    identity: string;
    mission: string;
    methodology: string;
    scope_and_relevance: string;
    standards: string;
    perspective: string;
  };
}

export interface WizardClarification {
  id: string;
  type: 'pill_row' | 'card_select' | 'tag_input';
  question: string;
  options?: { value: string; label: string; description?: string }[];
  multi_select?: boolean;
  placeholder?: string;
}

export interface WizardPlannerResponse {
  status: 'plan' | 'clarification';
  plan: WizardPlan | null;
  clarifications: WizardClarification[] | null;
}
