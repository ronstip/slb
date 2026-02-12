from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Post:
    post_id: str
    platform: str
    channel_handle: str
    post_url: str
    posted_at: datetime
    post_type: str
    channel_id: str | None = None
    title: str | None = None
    content: str | None = None
    parent_post_id: str | None = None
    media_urls: list[str] = field(default_factory=list)
    media_refs: list[dict] = field(default_factory=list)
    likes: int | None = None
    shares: int | None = None
    comments_count: int | None = None
    views: int | None = None
    saves: int | None = None
    comments: list[dict] = field(default_factory=list)
    platform_metadata: dict | None = None


@dataclass
class Channel:
    channel_id: str
    platform: str
    channel_handle: str
    subscribers: int | None = None
    total_posts: int | None = None
    channel_url: str | None = None
    description: str | None = None
    created_date: datetime | None = None
    channel_metadata: dict | None = None


@dataclass
class Batch:
    posts: list[Post] = field(default_factory=list)
    channels: list[Channel] = field(default_factory=list)
