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
    crawl_provider: str | None = None
    search_keyword: str | None = None
    # Pipeline-only signal: this post needs another post's text+media as
    # enrichment context. Set by the X adapter when a quote/reply is unpacked
    # alongside its referenced source. Read by mark_collected to decide whether
    # to set `awaits_dep_post_id` on the post_state. Not persisted to BQ as a
    # column (lives transiently on the dataclass; the BQ-persisted truth is
    # platform_metadata.referenced_post + parent_post_id).
    enrichment_dependency_post_id: str | None = None
    enrichment_dependency_type: str | None = None  # "quoted" | "replied_to"


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


@dataclass
class Comment:
    comment_id: str
    platform: str
    channel_handle: str
    commented_at: datetime
    channel_id: str | None = None
    content: str | None = None
    root_comment_id: str | None = None
    likes: int | None = None
    shares: int | None = None
    replies_count: int | None = None
    views: int | None = None
    media_urls: list[str] = field(default_factory=list)
    media_refs: list[dict] = field(default_factory=list)
    platform_metadata: dict | None = None
    crawl_provider: str | None = None
    # Pipeline-only: direct parent id (the comment/post this reply targets).
    # Used by resolve_comment_roots to walk up to the thread root; not persisted
    # as a column (the BQ-persisted truth is root_comment_id + platform_metadata).
    replied_to_id: str | None = None


@dataclass
class CommentBatch:
    comments: list[Comment] = field(default_factory=list)
    channels: list[Channel] = field(default_factory=list)
