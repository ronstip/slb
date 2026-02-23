from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    selected_sources: list[str] | None = None


class CreateCollectionRequest(BaseModel):
    description: str
    platforms: list[str]
    keywords: list[str]
    channel_urls: list[str] | None = None
    time_range_days: int = 90
    geo_scope: str = "global"
    max_calls: int = 2
    include_comments: bool = True
    ongoing: bool = False
    schedule: str | None = None  # "daily" | "weekly"


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
