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
