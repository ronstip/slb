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
