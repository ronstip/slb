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
    post_id = str(item.get("post_id") or "")
    username = item.get("profile_username") or ""

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
        channel_id=str(item.get("profile_id") or ""),
        title=None,
        content=item.get("description"),
        post_url=item.get("url") or "",
        posted_at=_parse_iso_timestamp(item.get("create_time")),
        post_type=item.get("post_type") or "video",
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
    username = item.get("account_id") or item.get("profile_username") or ""
    return Channel(
        channel_id=str(item.get("profile_id") or ""),
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
    video_id = str(item.get("video_id") or "")

    media_urls: list[str] = []
    preview = item.get("preview_image")
    if preview:
        media_urls.append(preview)
    elif video_id:
        media_urls.append(f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
    video_url = item.get("video_url")
    if video_url:
        media_urls.append(video_url)

    channel_handle = item.get("youtuber") or item.get("handle_name") or ""

    return Post(
        post_id=video_id,
        platform="youtube",
        channel_handle=channel_handle,
        channel_id=str(item.get("youtuber_id") or ""),
        title=item.get("title"),
        content=item.get("description"),
        post_url=item.get("url") or "",
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
    ch_id = str(item.get("youtuber_id") or "")
    name = item.get("youtuber") or item.get("handle_name") or ""
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
        post_id=str(item.get("post_id") or ""),
        platform="reddit",
        channel_handle=item.get("user_posted") or "",
        channel_id=item.get("community_name") or "",
        title=item.get("title"),
        content=item.get("description"),
        post_url=item.get("url") or "",
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
    community = item.get("community_name") or ""
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


# ---------------------------------------------------------------------------
# Facebook Groups
# ---------------------------------------------------------------------------

def parse_brightdata_facebook_group_post(item: dict) -> Post:
    """Parse a Facebook group post from Bright Data's dataset response.

    Real BD fields: url, post_id, user_url, user_username_raw, date_posted,
    num_comments, num_shares, group_name, group_id, group_url, group_intro,
    group_category, original_post, attachments, post_type, price, location,
    profile_id, num_reaction_type, is_sponsored, post_external_image, etc.
    """
    media_urls: list[str] = []

    # Extract content and media from original_post (dict with content, attachments)
    original = item.get("original_post")
    content = None
    if isinstance(original, dict):
        content = original.get("content") or original.get("text") or original.get("message")
        # Media from original_post.attachments
        orig_attachments = original.get("attachments") or []
        if isinstance(orig_attachments, list):
            for att in orig_attachments:
                if isinstance(att, dict) and att.get("url"):
                    media_urls.append(att["url"])

    # Fallback media from top-level fields
    ext_img = item.get("post_external_image")
    if ext_img and ext_img != "None" and ext_img not in media_urls:
        media_urls.append(ext_img)
    # Top-level attachments
    top_attachments = item.get("attachments") or []
    if isinstance(top_attachments, list):
        for att in top_attachments:
            if isinstance(att, dict) and att.get("url") and att["url"] not in media_urls:
                media_urls.append(att["url"])

    post_type_raw = item.get("post_type", "Post")
    post_type = post_type_raw.lower() if post_type_raw else "text"

    username = item.get("user_username_raw") or ""

    return Post(
        post_id=str(item.get("post_id") or ""),
        platform="facebook",
        channel_handle=username,
        channel_id=str(item.get("group_id") or ""),
        title=None,
        content=content,
        post_url=item.get("url") or "",
        posted_at=_parse_iso_timestamp(item.get("date_posted")),
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("num_likes")),
        shares=_safe_int(item.get("num_shares")),
        comments_count=_safe_int(item.get("num_comments")),
        views=None,
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "facebook",
            "source_type": "group",
            "group_name": item.get("group_name"),
            "group_url": item.get("group_url"),
            "group_category": item.get("group_category"),
            "group_members": _safe_int(item.get("group_members")),
            "author": username,
            "user_url": item.get("user_url"),
            "profile_id": item.get("profile_id"),
            "is_sponsored": item.get("is_sponsored"),
            "price": item.get("price"),
            "location": item.get("location"),
        },
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )


def parse_brightdata_facebook_group_channel(item: dict) -> Channel:
    """Parse a Facebook group as a channel from Bright Data's post response."""
    group_id = str(item.get("group_id") or item.get("group_url") or "")
    group_name = item.get("group_name") or ""
    return Channel(
        channel_id=group_id,
        platform="facebook",
        channel_handle=group_name,
        subscribers=_safe_int(item.get("group_members")),
        total_posts=None,
        channel_url=item.get("group_url", ""),
        description=item.get("group_intro") if item.get("group_intro") != "None" else None,
        created_date=_parse_iso_timestamp(item.get("group_created_at")) if item.get("group_created_at") else None,
        channel_metadata={
            "channel_type": "group",
            "group_category": item.get("group_category"),
        },
    )


# ---------------------------------------------------------------------------
# Facebook Marketplace
# ---------------------------------------------------------------------------

def parse_brightdata_facebook_marketplace_post(item: dict) -> Post:
    """Parse a Facebook Marketplace listing from Bright Data's dataset response."""
    images = item.get("images") or []
    videos = item.get("videos") or []
    media_urls = images + videos

    title = item.get("title") or ""
    description = item.get("description") or ""
    content = f"{title}\n{description}".strip() if description else title

    return Post(
        post_id=str(item.get("product_id") or ""),
        platform="facebook",
        channel_handle=item.get("profile_id") or "",
        channel_id=item.get("profile_id") or "",
        title=title,
        content=content,
        post_url=item.get("url") or "",
        posted_at=_parse_iso_timestamp(item.get("listing_date")),
        post_type="marketplace_listing",
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=None,
        shares=None,
        comments_count=None,
        views=None,
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "facebook",
            "source_type": "marketplace",
            "initial_price": item.get("initial_price"),
            "final_price": item.get("final_price"),
            "currency": item.get("currency"),
            "condition": item.get("condition"),
            "location": item.get("location"),
            "country_code": item.get("country_code"),
            "category": item.get("root_category"),
            "brand": item.get("brand"),
            "color": item.get("color"),
            "seller_description": item.get("seller_description"),
        },
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )


def parse_brightdata_facebook_marketplace_channel(item: dict) -> Channel:
    """Stub channel parser for marketplace listings (sellers are minimal)."""
    profile_id = item.get("profile_id") or ""
    return Channel(
        channel_id=str(profile_id),
        platform="facebook",
        channel_handle=str(profile_id),
        subscribers=None,
        total_posts=None,
        channel_url="",
        description=item.get("seller_description"),
        created_date=None,
        channel_metadata={"channel_type": "marketplace_seller"},
    )
