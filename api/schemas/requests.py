from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    selected_sources: list[str] | None = None
    model: str | None = None  # "flash" (default) or "pro"


class VendorConfig(BaseModel):
    default: str = "brightdata"  # "brightdata" | "vetric"
    platform_overrides: dict[str, str] | None = None  # e.g., {"tiktok": "brightdata"}


class CreateCollectionRequest(BaseModel):
    description: str
    platforms: list[str]
    keywords: list[str]
    channel_urls: list[str] | None = None
    time_range_days: int = 90
    geo_scope: str = "global"
    n_posts: int = 0
    include_comments: bool = True
    ongoing: bool = False
    schedule: str | None = None  # "daily" | "weekly"
    vendor_config: VendorConfig | None = None
    # Enrichment config (optional, set by design_research)
    custom_fields: list[dict] | None = None
    video_params: dict | None = None
    reasoning_level: str | None = None
    min_likes: int | None = None


class UpdateCollectionModeRequest(BaseModel):
    ongoing: bool
    schedule: str | None = None  # required when ongoing=True


# --- Settings ---


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    preferences: dict | None = None


class UpdateOrgRequest(BaseModel):
    name: str | None = None
    domain: str | None = None


class InviteMemberRequest(BaseModel):
    email: str
    role: str = "member"


class UpdateMemberRoleRequest(BaseModel):
    role: str


class MultiFeedRequest(BaseModel):
    collection_ids: list[str]
    sort: str = "views"
    platform: str = "all"
    sentiment: str = "all"
    limit: int = 12
    offset: int = 0
    topic_cluster_id: str | None = None


class DashboardDataRequest(BaseModel):
    collection_ids: list[str]


class CreateDashboardShareRequest(BaseModel):
    dashboard_id: str
    collection_ids: list[str]
    title: str
