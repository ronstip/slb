from typing import Any

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
    key_quotes: list[str] = []
    custom_fields: dict | None = None
    collection_id: str | None = None


class FeedResponse(BaseModel):
    posts: list[FeedPostResponse]
    total: int
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
    sentiment: str | None = None
    emotion: str | None = None
    themes: list[str] = []
    entities: list[str] = []
    language: str | None = None
    content_type: str | None = None
    key_quotes: list[str] = []
    like_count: int = 0
    view_count: int = 0
    comment_count: int = 0
    share_count: int = 0


class DashboardDataResponse(BaseModel):
    posts: list[DashboardPostResponse]
    collection_names: dict[str, str]
    truncated: bool = False


class DashboardShareResponse(BaseModel):
    token: str
    dashboard_id: str
    title: str
    collection_ids: list[str]
    created_at: str
    share_url: str
    active: bool = True


class SharedDashboardMetaResponse(BaseModel):
    title: str
    created_at: str


class SharedDashboardDataResponse(BaseModel):
    posts: list[DashboardPostResponse]
    collection_names: dict[str, str]
    truncated: bool = False
    meta: SharedDashboardMetaResponse


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


class UsageResponse(BaseModel):
    period_start: str
    period_end: str
    queries_used: int = 0
    queries_limit: int = 50
    collections_created: int = 0
    collections_limit: int = 3
    posts_collected: int = 0
    posts_limit: int = 500


class UsageTrendPoint(BaseModel):
    date: str
    queries: int = 0
    collections: int = 0
    posts: int = 0
    user_name: str | None = None
    user_id: str | None = None


class UsageTrendResponse(BaseModel):
    points: list[UsageTrendPoint]
    granularity: str = "daily"


class CreditBalanceResponse(BaseModel):
    credits_remaining: int = 0
    credits_used: int = 0
    credits_total: int = 0
    is_org: bool = False


class CreditPackResponse(BaseModel):
    pack_id: str
    name: str
    credits: int
    price_cents: int
    popular: bool = False


class CreditPurchaseHistoryItem(BaseModel):
    purchased_at: str
    credits: int
    amount_cents: int
    purchased_by: str | None = None
    purchased_by_name: str | None = None


# --- Sessions ---


class SessionListItem(BaseModel):
    session_id: str
    title: str
    created_at: str | None = None
    updated_at: str | None = None
    message_count: int = 0
    preview: str | None = None


class SessionDetailResponse(BaseModel):
    session_id: str
    title: str
    state: dict
    events: list[dict]
