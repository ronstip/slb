"""Transform Bright Data API responses into Post/Channel model instances.

Each platform has its own parse function pair because Bright Data returns
different schemas per platform. All parsers use defensive .get() with
defaults so missing fields produce valid objects, never crashes.
"""

import logging
from datetime import datetime, timezone

from workers.collection.models import Channel, Post

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared Utilities
# ---------------------------------------------------------------------------

def _safe_int(val) -> int | None:
    """Bright Data sometimes returns strings for numeric fields (e.g., share_count: "6528")."""
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    if isinstance(val, str):
        try:
            return int(val.replace(",", ""))
        except ValueError:
            return None
    return None


def _parse_iso_timestamp(val) -> datetime:
    """Parse ISO 8601 timestamps like '2026-03-05T23:14:46.000Z'. Falls back to now()."""
    if isinstance(val, (int, float)) and val > 0:
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str) and val:
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _extract_search_keyword(item: dict) -> str | None:
    """Extract keyword from discovery_input (field name differs by platform)."""
    di = item.get("discovery_input") or {}
    return di.get("search_keyword") or di.get("keyword")


# ---------------------------------------------------------------------------
# TikTok
# ---------------------------------------------------------------------------

def parse_brightdata_tiktok_post(item: dict) -> Post:
    """Parse a TikTok post from Bright Data's dataset response."""
    post_id = str(item.get("post_id", ""))
    username = item.get("profile_username", "")

    # Media URLs — skip video_url (TikTok CDN tokens expire within minutes,
    # causing 100% 403 failures). Keep thumbnails + carousel images only.
    media_urls: list[str] = []
    preview = item.get("preview_image")
    if preview:
        media_urls.append(preview)
    carousel = item.get("carousel_images") or []
    media_urls.extend(carousel)

    # Hashtags
    hashtags = item.get("hashtags") or []

    return Post(
        post_id=post_id,
        platform="tiktok",
        channel_handle=username,
        channel_id=str(item.get("profile_id", "")),
        title=None,
        content=item.get("description"),
        post_url=item.get("url", ""),
        posted_at=_parse_iso_timestamp(item.get("create_time")),
        post_type=item.get("post_type", "video"),
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("digg_count")),
        shares=_safe_int(item.get("share_count")),
        comments_count=_safe_int(item.get("comment_count")),
        views=_safe_int(item.get("play_count")),
        saves=_safe_int(item.get("collect_count")),
        comments=[],
        platform_metadata={
            "platform": "tiktok",
            "author": username,
            "follower_count": _safe_int(item.get("profile_followers")),
            "hashtags": hashtags,
            "is_verified": item.get("is_verified"),
            "video_duration": item.get("video_duration"),
            "music": item.get("music"),
            "region": item.get("region"),
            "video_url": item.get("video_url"),  # stored for future yt-dlp pipeline
        },
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )


def parse_brightdata_tiktok_channel(item: dict) -> Channel:
    """Parse a TikTok channel from Bright Data's post response (profile fields embedded)."""
    username = item.get("account_id") or item.get("profile_username", "")
    return Channel(
        channel_id=str(item.get("profile_id", "")),
        platform="tiktok",
        channel_handle=username,
        subscribers=_safe_int(item.get("profile_followers")),
        total_posts=None,
        channel_url=item.get("profile_url") or (f"https://www.tiktok.com/@{username}" if username else ""),
        description=item.get("profile_biography"),
        created_date=None,
        channel_metadata={
            "verified": item.get("is_verified"),
            "avatar_url": item.get("profile_avatar"),
        },
    )


# ---------------------------------------------------------------------------
# YouTube
# ---------------------------------------------------------------------------

def parse_brightdata_youtube_post(item: dict) -> Post:
    """Parse a YouTube video from Bright Data's dataset response."""
    video_id = str(item.get("video_id", ""))

    media_urls: list[str] = []
    preview = item.get("preview_image")
    if preview:
        media_urls.append(preview)
    elif video_id:
        media_urls.append(f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
    video_url = item.get("video_url")
    if video_url:
        media_urls.append(video_url)

    channel_handle = item.get("youtuber") or item.get("handle_name", "")

    return Post(
        post_id=video_id,
        platform="youtube",
        channel_handle=channel_handle,
        channel_id=str(item.get("youtuber_id", "")),
        title=item.get("title"),
        content=item.get("description"),
        post_url=item.get("url", ""),
        posted_at=_parse_iso_timestamp(item.get("date_posted")),
        post_type="video",
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("likes")),
        shares=None,
        comments_count=_safe_int(item.get("num_comments")),
        views=_safe_int(item.get("views")),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "youtube",
            "channel_name": channel_handle,
            "channel_id": item.get("youtuber_id"),
            "tags": item.get("tags"),
            "transcript": item.get("transcript"),
            "video_length": item.get("video_length"),
            "is_sponsored": item.get("is_sponsored"),
            "channel_url": item.get("channel_url"),
        },
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )


def parse_brightdata_youtube_channel(item: dict) -> Channel:
    """Parse a YouTube channel from Bright Data's post response (channel fields embedded)."""
    ch_id = str(item.get("youtuber_id", ""))
    name = item.get("youtuber") or item.get("handle_name", "")
    return Channel(
        channel_id=ch_id,
        platform="youtube",
        channel_handle=name,
        subscribers=_safe_int(item.get("subscribers")),
        total_posts=None,
        channel_url=item.get("channel_url") or (f"https://www.youtube.com/channel/{ch_id}" if ch_id else ""),
        description=None,
        created_date=None,
        channel_metadata={
            "verified": item.get("verified"),
        },
    )


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------

def parse_brightdata_reddit_post(item: dict) -> Post:
    """Parse a Reddit post from Bright Data's dataset response."""
    # Media URLs
    media_urls: list[str] = []
    photos = item.get("photos") or []
    media_urls.extend(photos)
    videos = item.get("videos") or []
    media_urls.extend(videos)

    # Infer post type from media
    if videos:
        post_type = "video"
    elif photos:
        post_type = "image"
    else:
        post_type = "text"

    return Post(
        post_id=str(item.get("post_id", "")),
        platform="reddit",
        channel_handle=item.get("user_posted", ""),
        channel_id=item.get("community_name", ""),
        title=item.get("title"),
        content=item.get("description"),
        post_url=item.get("url", ""),
        posted_at=_parse_iso_timestamp(item.get("date_posted")),
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("num_upvotes")),
        shares=None,
        comments_count=_safe_int(item.get("num_comments")),
        views=None,
        saves=None,
        comments=item.get("comments") or [],
        platform_metadata={
            "platform": "reddit",
            "subreddit": item.get("community_name"),
            "author": item.get("user_posted"),
            "tag": item.get("tag"),
            "community_rank": item.get("community_rank"),
        },
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )


def parse_brightdata_reddit_channel(item: dict) -> Channel:
    """Parse a Reddit community/channel from Bright Data's post response."""
    community = item.get("community_name", "")
    return Channel(
        channel_id=community,
        platform="reddit",
        channel_handle=community,
        subscribers=_safe_int(item.get("community_members_num")),
        total_posts=None,
        channel_url=item.get("community_url") or (f"https://www.reddit.com/r/{community}" if community else ""),
        description=item.get("community_description"),
        created_date=None,
        channel_metadata={},
    )
