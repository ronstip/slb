import json
from datetime import datetime, timezone

from workers.collection.models import Channel, Post


def post_to_bq_row(post: Post, collection_id: str) -> dict:
    """Convert a Post to a BigQuery row dict."""
    return {
        "post_id": post.post_id,
        "collection_id": collection_id,
        "platform": post.platform,
        "channel_handle": post.channel_handle,
        "channel_id": post.channel_id,
        "title": post.title,
        "content": post.content,
        "post_url": post.post_url,
        "posted_at": post.posted_at.isoformat() if post.posted_at else None,
        "post_type": post.post_type,
        "parent_post_id": post.parent_post_id,
        "media_refs": json.dumps(post.media_refs) if post.media_refs else "[]",
        "platform_metadata": json.dumps(post.platform_metadata) if post.platform_metadata else None,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


def post_to_engagement_row(post: Post) -> dict:
    """Extract initial engagement data from a Post into a BQ row."""
    from uuid import uuid4

    return {
        "engagement_id": str(uuid4()),
        "post_id": post.post_id,
        "likes": post.likes,
        "shares": post.shares,
        "comments_count": post.comments_count,
        "views": post.views,
        "saves": post.saves,
        "comments": json.dumps(post.comments) if post.comments else "[]",
        "platform_engagements": None,
        "source": "initial",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def channel_to_bq_row(channel: Channel, collection_id: str) -> dict:
    """Convert a Channel to a BigQuery row dict."""
    return {
        "channel_id": channel.channel_id,
        "collection_id": collection_id,
        "platform": channel.platform,
        "channel_handle": channel.channel_handle,
        "subscribers": channel.subscribers,
        "total_posts": channel.total_posts,
        "channel_url": channel.channel_url,
        "description": channel.description,
        "created_date": channel.created_date.isoformat() if channel.created_date else None,
        "channel_metadata": json.dumps(channel.channel_metadata) if channel.channel_metadata else None,
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }
