from typing import Any, Literal

from pydantic import BaseModel


class CollectionStatusResponse(BaseModel):
    collection_id: str
    status: str
    posts_collected: int = 0
    posts_enriched: int = 0
    total_views: int = 0
    positive_pct: float | None = None
    error_message: str | None = None
    config: dict | None = None
    created_at: str | None = None
    visibility: str = "private"
    user_id: str | None = None


class FeedPostResponse(BaseModel):
    post_id: str
    platform: str
    channel_handle: str
    channel_id: str | None = None
    title: str | None = None
    content: str | None = None
    post_url: str
    posted_at: str
    post_type: str
    media_refs: list[Any] = []
    likes: int = 0
    shares: int = 0
    views: int = 0
    comments_count: int = 0
    saves: int = 0
    total_engagement: int = 0
    sentiment: str | None = None
    emotion: str | None = None
    themes: list[str] = []
    entities: list[str] = []
    ai_summary: str | None = None
    content_type: str | None = None
    language: str | None = None
    custom_fields: dict | None = None
    context: str | None = None
    detected_brands: list[str] = []
    channel_type: str | None = None
    collection_id: str | None = None
    is_retweet: bool | None = None
    is_quote: bool | None = None


class FeedResponse(BaseModel):
    posts: list[FeedPostResponse]
    total: int
    total_views: int = 0
    total_sources: int = 0
    offset: int
    limit: int


class DashboardPostResponse(BaseModel):
    post_id: str
    collection_id: str
    platform: str
    channel_handle: str = ""
    posted_at: str = ""
    title: str | None = None
    content: str | None = None
    post_url: str = ""
    sentiment: str | None = None
    emotion: str | None = None
    themes: list[str] = []
    entities: list[str] = []
    language: str | None = None
    content_type: str | None = None
    custom_fields: dict | None = None
    ai_summary: str | None = None
    context: str | None = None
    detected_brands: list[str] = []
    channel_type: str | None = None
    media_refs: str | None = None
    like_count: int = 0
    view_count: int = 0
    comment_count: int = 0
    share_count: int = 0


class DashboardKpis(BaseModel):
    total_posts: int = 0
    total_views: int = 0
    total_likes: int = 0
    total_comments: int = 0
    total_shares: int = 0


class TopicBreakdownEntry(BaseModel):
    value: str
    count: int = 0


class TopicPlatformEntry(BaseModel):
    platform: str
    posts: int = 0
    views: int = 0
    likes: int = 0
    engagement: int = 0


class TopicMetricsResponse(BaseModel):
    cluster_id: str
    header: str | None = None
    subheader: str | None = None
    beat_type: str | None = None
    keywords: list[str] = []
    thumbnail_url: str | None = None
    thumbnail_gcs_uri: str | None = None
    top_content_type: str | None = None
    top_emotion: str | None = None
    post_count: int = 0
    total_views: int = 0
    total_likes: int = 0
    total_comments: int = 0
    total_shares: int = 0
    total_engagement: int = 0
    avg_engagement_per_post: float = 0
    positive_count: int = 0
    negative_count: int = 0
    neutral_count: int = 0
    mixed_count: int = 0
    net_sentiment: float | None = None
    recency_score: float = 0
    signal_score: float = 0
    sov_posts: float = 0
    sov_views: float = 0
    sov_engagement: float = 0
    estimated_post_count: int = 0
    estimated_views: int = 0
    unique_channels: int = 0
    unique_channels_ugc: int = 0
    unique_channels_official: int = 0
    unique_channels_media: int = 0
    unique_channels_influencers: int = 0
    earliest_post: str | None = None
    median_post_time: str | None = None
    latest_post: str | None = None
    platforms_breakdown: list[TopicPlatformEntry] = []
    themes_counts: list[TopicBreakdownEntry] = []
    emotion_counts: list[TopicBreakdownEntry] = []
    entities_counts: list[TopicBreakdownEntry] = []
    detected_brands_counts: list[TopicBreakdownEntry] = []
    channel_type_counts: list[TopicBreakdownEntry] = []
    content_type_counts: list[TopicBreakdownEntry] = []


class DashboardDataResponse(BaseModel):
    posts: list[DashboardPostResponse]
    topics: list[TopicMetricsResponse] = []
    collection_names: dict[str, str]
    truncated: bool = False
    kpis: DashboardKpis | None = None


class DashboardShareResponse(BaseModel):
    token: str
    dashboard_id: str
    title: str
    collection_ids: list[str]
    created_at: str
    share_url: str
    active: bool = True


class FeedLinkResponse(BaseModel):
    token: str
    title: str
    collection_ids: list[str]
    filters: dict = {}
    created_at: str
    share_url: str
    active: bool = True
    access_count: int = 0


class SharedDashboardMetaResponse(BaseModel):
    title: str
    created_at: str


class SharedDashboardDataResponse(BaseModel):
    posts: list[DashboardPostResponse]
    topics: list[TopicMetricsResponse] = []
    collection_names: dict[str, str]
    truncated: bool = False
    meta: SharedDashboardMetaResponse
    # Owner's saved widget layout, copied through on the public endpoint so
    # custom widgets (text cards, custom charts, reorderings) survive sharing.
    # None when the owner never saved a layout (default preset is used then).
    layout: list[dict[str, Any]] | None = None
    filterBarFilters: list[str] | None = None
    orientation: Literal["horizontal", "vertical"] | None = None
    # The data scope this dashboard's report committed to (if any). The frontend
    # locks the filter bar chips for these dimensions; viewer filters intersect
    # with the scope. Absence = standalone dashboard, no locking.
    reportScope: dict[str, Any] | None = None
    # Editor toggle: when true, the public viewer should not render the filter
    # bar at all (this is a curated report, not an exploration surface).
    filterBarHidden: bool | None = None


class BriefingShareResponse(BaseModel):
    token: str
    agent_id: str
    title: str
    created_at: str
    share_url: str
    active: bool = True


class BriefingMetaResponse(BaseModel):
    exists: bool
    generated_at: str | None = None


class SharedBriefingMetaResponse(BaseModel):
    title: str
    created_at: str


class SharedBriefingDataResponse(BaseModel):
    layout: dict
    meta: SharedBriefingMetaResponse


class ArtifactShareResponse(BaseModel):
    token: str
    artifact_id: str
    title: str
    created_at: str
    share_url: str
    active: bool = True


class SharedArtifactMetaResponse(BaseModel):
    title: str
    type: str
    created_at: str


class SharedArtifactDataResponse(BaseModel):
    payload: dict
    meta: SharedArtifactMetaResponse


class BreakdownItem(BaseModel):
    value: str
    post_count: int = 0
    view_count: int = 0
    like_count: int = 0


class EngagementStats(BaseModel):
    total_likes: int = 0
    total_views: int = 0
    total_comments: int = 0
    total_shares: int = 0
    avg_likes: float = 0
    avg_views: float = 0
    avg_comments: float = 0
    avg_shares: float = 0
    max_likes: float = 0
    max_views: float = 0
    median_likes: float = 0
    median_views: float = 0


class DailyVolumeItem(BaseModel):
    post_date: str
    platform: str
    post_count: int = 0


class CollectionStatsResponse(BaseModel):
    computed_at: str | None = None
    collection_status_at_compute: str | None = None
    total_posts: int
    total_unique_channels: int = 0
    date_range: dict
    platform_breakdown: list[BreakdownItem]
    sentiment_breakdown: list[BreakdownItem]
    top_themes: list[BreakdownItem]
    top_entities: list[BreakdownItem] = []
    language_breakdown: list[BreakdownItem] = []
    content_type_breakdown: list[BreakdownItem] = []
    negative_sentiment_pct: float | None = None
    total_posts_enriched: int = 0
    daily_volume: list[DailyVolumeItem] = []
    engagement_summary: EngagementStats


# --- Settings ---


class OrgMemberResponse(BaseModel):
    uid: str
    email: str | None
    display_name: str | None
    photo_url: str | None
    role: str | None


class OrgDetailsResponse(BaseModel):
    org_id: str
    name: str
    slug: str | None
    domain: str | None
    members: list[OrgMemberResponse]
    subscription_plan: str | None = None
    subscription_status: str | None = None
    billing_cycle: str | None = None
    current_period_end: str | None = None


class OrgInviteResponse(BaseModel):
    invite_id: str
    email: str
    role: str
    status: str
    invite_code: str
    created_at: str
    expires_at: str


class SubscriptionResponse(BaseModel):
    status: str | None
    plan: str | None
    billing_cycle: str | None
    current_period_end: str | None
    cancel_at_period_end: bool = False
    is_org: bool = False


# §E: usage is now $-wallet + action counts (no quota limits, no $ breakdown).
class UsageResponse(BaseModel):
    period_start: str
    period_end: str
    tier: str = "free"
    trial_expires_at: str | None = None
    balance_micros: int = 0
    total_in_micros: int = 0
    spent_micros: int = 0
    progress_pct: float = 0.0
    chats: int = 0
    collections: int = 0
    posts: int = 0


# §E credit wallet ($-based, USD micros).
class WalletResponse(BaseModel):
    balance_micros: int = 0
    total_in_micros: int = 0
    spent_micros: int = 0
    progress_pct: float = 0.0


class TopUpOption(BaseModel):
    amount_cents: int
    label: str
    popular: bool = False


class CreditTransactionItem(BaseModel):
    id: str
    kind: str
    amount_micros: int
    balance_after_micros: int = 0
    reason: str | None = None
    created_by: str | None = None
    created_at: str | None = None


# --- Sessions ---


class SessionListItem(BaseModel):
    session_id: str
    title: str
    created_at: str | None = None
    updated_at: str | None = None
    message_count: int = 0
    preview: str | None = None
    task_id: str | None = None


class SessionDetailResponse(BaseModel):
    session_id: str
    title: str
    state: dict
    events: list[dict]
