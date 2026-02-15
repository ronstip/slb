from typing import Any

from pydantic import BaseModel


class CollectionStatusResponse(BaseModel):
    collection_id: str
    status: str
    posts_collected: int = 0
    posts_enriched: int = 0
    posts_embedded: int = 0
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
    themes: list[str] = []
    entities: list[str] = []
    ai_summary: str | None = None
    content_type: str | None = None


class FeedResponse(BaseModel):
    posts: list[FeedPostResponse]
    total: int
    offset: int
    limit: int


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
