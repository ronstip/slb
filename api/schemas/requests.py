from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    agent_id: str | None = None  # Active agent - auto-loads agent context into session
    model: str | None = None  # "flash-lite", "flash" (default) or "pro"
    # Per-request thinking override: "off" disables, otherwise minimal|low|medium|high.
    # None = fall back to settings.agent_thinking_level.
    thinking_level: str | None = None
    # Per-request Google Search grounding override. None = fall back to
    # settings.enable_search_grounding.
    search_grounding: bool | None = None
    is_system: bool = False  # True for system-generated messages (e.g., collection continuation)
    accent_color: str | None = None  # User's selected accent hex, e.g. "#4A7C8F"
    theme: str | None = None  # Resolved theme: "light" or "dark"
    # Agent persona. "chat" (default) is the broad analyst. "report_editor" is
    # the in-place dashboard co-author used by the AI button in the report
    # top bar; requires `active_dashboard_id`.
    mode: Literal["chat", "report_editor"] = "chat"
    active_dashboard_id: str | None = None


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
    # Direct-fetch mode: when set, the adapter fetches exactly these posts and
    # ignores keywords/channel_urls/time_range_days. Used by the "Add post by
    # URL" feature; pipeline routing is identical to keyword mode.
    post_urls: list[str] | None = None


class FetchPostsByUrlRequest(BaseModel):
    urls: list[str]
    note: str | None = None              # optional label → collection description
    include_comments: bool = False       # default OFF; opt-in via drawer checkbox



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
    has_media: bool = False
    dedup: bool = True
    start_date: str | None = None  # ISO datetime or YYYY-MM-DD; lower-bound on p.posted_at
    end_date: str | None = None  # ISO datetime or YYYY-MM-DD; upper-bound on p.posted_at
    agent_id: str | None = None  # When set, posts are scoped via the scope_posts TVF


class DashboardDataRequest(BaseModel):
    collection_ids: list[str]
    agent_id: str | None = None  # When set, dashboard data is scoped via scope_posts TVF


class CreateDashboardShareRequest(BaseModel):
    dashboard_id: str
    collection_ids: list[str]
    title: str
    agent_id: str | None = None  # Stored on the share so public renders use the same agent scope


class CreateCustomSlugShareRequest(BaseModel):
    dashboard_id: str
    collection_ids: list[str]
    title: str
    agent_id: str | None = None
    slug: str  # Validated server-side; becomes the Firestore doc ID and URL path segment


class CreateBriefingShareRequest(BaseModel):
    agent_id: str
    title: str


class CreateArtifactShareRequest(BaseModel):
    artifact_id: str


class CreateFeedLinkRequest(BaseModel):
    collection_ids: list[str]
    filters: dict = Field(default_factory=dict)
    title: str
    agent_id: str | None = None  # Stored on the link so public renders use the same agent scope


class SetCollectionVisibilityRequest(BaseModel):
    visibility: Literal["private", "org"]


class CreateFromWizardRequest(BaseModel):
    title: str
    description: str = ""
    agent_type: str = "one_shot"
    # New flat shape - preferred. Each source is one platform with its own
    # keywords / n_posts / time_range / geo / channels.
    sources: list[dict] = []
    # Legacy shape - accepted for backward compat with old clients. Server
    # normalizes either field into `data_scope.sources` before persisting.
    searches: list[dict] = []
    schedule: dict | None = None
    custom_fields: list[dict] | None = None
    enrichment_context: str = ""
    content_types: list[str] = []
    context: dict | None = None  # Deprecated: old AgentContext (4 fields). Use constitution instead.
    constitution: dict | None = None  # 6-section Constitution: {identity, mission, methodology, scope_and_relevance, standards, perspective}
    existing_collection_ids: list[str] = []
    existing_agent_ids: list[str] = []
    # Typed outputs list - preferred. When provided, supersedes the auto_* flags.
    outputs: list[dict] | None = None
    # Legacy flags - kept for backward compat with older clients. New code should
    # send `outputs` instead.
    auto_report: bool = True
    auto_email: bool = False
    auto_slides: bool = False
    email_recipients: list[str] = []
    start_run: bool = True
    # Agent-level data window. Server fills `data_start_date` from the
    # broadest source `time_range_days` if omitted; `data_end_date` stays
    # NULL by default (no upper bound).
    data_start_date: str | None = None
    data_end_date: str | None = None


class UpdateCollectionRequest(BaseModel):
    title: str | None = None
    visibility: str | None = None


class RunSourcesRequest(BaseModel):
    # Targeting: pass `source_idx` for a single card, `platform` to refresh
    # every card on that platform, or omit both to refresh all sources.
    source_idx: int | None = None
    platform: str | None = None
