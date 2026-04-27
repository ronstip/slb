from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    agent_id: str | None = None  # Active agent — auto-loads agent context into session
    model: str | None = None  # "flash" (default) or "pro"
    is_system: bool = False  # True for system-generated messages (e.g., collection continuation)
    accent_color: str | None = None  # User's selected accent hex, e.g. "#4A7C8F"
    theme: str | None = None  # Resolved theme: "light" or "dark"


class VendorConfig(BaseModel):
    default: str = "brightdata"  # "brightdata" | "vetric" | "xapi"
    platform_overrides: dict[str, str] | None = None  # e.g., {"twitter": "vetric"}


class CreateCollectionRequest(BaseModel):
    description: str
    platforms: list[str]
    keywords: list[str]
    channel_urls: list[str] | None = None
    time_range_days: int = 90
    geo_scope: str = "global"
    n_posts: int = 0
    include_comments: bool = True
    vendor_config: VendorConfig | None = None
    # Enrichment config (optional, set by design_research)
    custom_fields: list[dict] | None = None
    video_params: dict | None = None
    reasoning_level: str | None = None
    min_likes: int | None = None
    has_media: Literal["with", "without", "any"] | None = None  # X adapter; default "with"



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
    relevant_to_task: str = "true"  # "all" | "true" | "false"
    limit: int = 12
    offset: int = 0
    topic_cluster_id: str | None = None
    has_media: bool = False
    dedup: bool = True
    start_date: str | None = None  # YYYY-MM-DD; lower-bound on p.posted_at


class DashboardDataRequest(BaseModel):
    collection_ids: list[str]


class CreateDashboardShareRequest(BaseModel):
    dashboard_id: str
    collection_ids: list[str]
    title: str


class CreateFeedLinkRequest(BaseModel):
    collection_ids: list[str]
    filters: dict = Field(default_factory=dict)
    title: str


class SetCollectionVisibilityRequest(BaseModel):
    visibility: Literal["private", "org"]


class CreateFromWizardRequest(BaseModel):
    title: str
    description: str = ""
    agent_type: str = "one_shot"
    searches: list[dict] = []
    schedule: dict | None = None
    custom_fields: list[dict] | None = None
    enrichment_context: str = ""
    content_types: list[str] = []
    context: dict | None = None  # Deprecated: old AgentContext (4 fields). Use constitution instead.
    constitution: dict | None = None  # 6-section Constitution: {identity, mission, methodology, scope_and_relevance, standards, perspective}
    existing_collection_ids: list[str] = []
    existing_agent_ids: list[str] = []
    auto_report: bool = True
    auto_email: bool = False
    auto_slides: bool = False
    email_recipients: list[str] = []


class UpdateCollectionRequest(BaseModel):
    title: str | None = None
    visibility: str | None = None
