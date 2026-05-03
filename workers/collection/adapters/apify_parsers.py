"""Transform Apify actor dataset items into Post/Channel model instances.

Each (platform, actor_id) pair is registered in `_PARSER_REGISTRY`.
ApifyAdapter looks up the parser at init time and fail-fast raises if a
configured actor has no parser entry — swapping actors via env requires
also registering a parser.

Field-name fallbacks: actor outputs occasionally rename or remove keys
between builds, so each parser tries multiple known names via
`_first(item, "key_a", "key_b", ...)`.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from workers.collection.models import Channel, Post

logger = logging.getLogger(__name__)


ParsePostFn = Callable[[dict], Post]
ParseChannelFn = Callable[[dict], Channel]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _first(item: dict, *keys: str, default: Any = None) -> Any:
    """Return the first non-None, non-empty-string value among the listed keys."""
    for key in keys:
        if key in item:
            value = item[key]
            if value is None:
                continue
            if isinstance(value, str) and not value:
                continue
            return value
    return default


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_dt(value: Any) -> datetime | None:
    """Parse a datetime from int/float (unix seconds), ISO string, or None.

    Always returns tz-aware UTC. Returns None on failure — callers must handle
    None and ideally drop the item (consistent with `time_range_gate`).
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    return None


def _hash_id(seed: str) -> str:
    """Stable 16-char id from a seed (e.g. post URL) when no native id exists."""
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Instagram — apify/instagram-scraper
# Sample dataset shape (captured from live run, see smoke_apify_out.json):
#   id, shortCode, url, type (Image|Video|Sidecar), caption, hashtags, mentions,
#   timestamp (ISO), ownerUsername, ownerFullName, ownerId, likesCount,
#   commentsCount, displayUrl, images[], videoUrl, videoViewCount, videoPlayCount,
#   childPosts[], musicInfo{}, productType, latestComments[], firstComment.
# ---------------------------------------------------------------------------

_IG_TYPE_MAP = {
    "Image": "image",
    "GraphImage": "image",
    "Video": "video",
    "GraphVideo": "video",
    "Sidecar": "carousel",
    "GraphSidecar": "carousel",
    "Reel": "video",
    "Clip": "video",
}


def parse_apify_instagram_post(item: dict) -> Post:
    short_code = _first(item, "shortCode", "code", default="")
    post_url = _first(
        item, "url", "postUrl",
        default=f"https://www.instagram.com/p/{short_code}/" if short_code else "",
    )
    post_id = str(_first(item, "id", "pk", default="")) or _hash_id(post_url)

    posted_at = (
        _parse_dt(_first(item, "timestamp", "takenAtTimestamp"))
        or datetime.fromtimestamp(0, tz=timezone.utc)
    )

    media_type_raw = _first(item, "type", "media_type", default="Image")
    post_type = _IG_TYPE_MAP.get(str(media_type_raw), "image")

    owner_username = _first(item, "ownerUsername", "ownerName", default="")
    owner_id = str(_first(item, "ownerId", default=""))

    media_urls: list[str] = []
    display_url = item.get("displayUrl")
    if display_url:
        media_urls.append(display_url)
    video_url = item.get("videoUrl")
    if video_url:
        media_urls.append(video_url)
    images = item.get("images") or []
    if isinstance(images, list):
        media_urls.extend(u for u in images if isinstance(u, str))

    return Post(
        post_id=post_id,
        platform="instagram",
        channel_handle=owner_username,
        channel_id=owner_id or None,
        title=None,
        content=_first(item, "caption", default=""),
        post_url=post_url,
        posted_at=posted_at,
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("likesCount")),
        shares=None,
        comments_count=_safe_int(item.get("commentsCount")),
        views=_safe_int(_first(item, "videoViewCount", "videoPlayCount")),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "instagram",
            "media_type_raw": media_type_raw,
            "hashtags": item.get("hashtags") or [],
            "mentions": item.get("mentions") or [],
            "product_type": item.get("productType"),
            "input_url": item.get("inputUrl"),
        },
        crawl_provider="apify",
    )


def parse_apify_instagram_channel(item: dict) -> Channel:
    username = _first(item, "ownerUsername", "ownerName", default="")
    return Channel(
        channel_id=str(_first(item, "ownerId", default="")),
        platform="instagram",
        channel_handle=username,
        subscribers=_safe_int(item.get("ownerFollowersCount")),
        total_posts=None,
        channel_url=f"https://www.instagram.com/{username}/" if username else None,
        description=None,
        created_date=None,
        channel_metadata={
            "verified": item.get("ownerIsVerified"),
            "full_name": item.get("ownerFullName"),
        },
    )


# ---------------------------------------------------------------------------
# Facebook — scrapeforge/facebook-search-posts
# Sample dataset shape:
#   post_id, type, url, message, message_rich, timestamp (unix sec),
#   comments_count, reactions_count, reshare_count,
#   reactions{like, love, haha, wow, sad, angry, care},
#   author{id, name, url, profile_picture_url}, author_title,
#   image, video, video_files, video_thumbnail, album_preview,
#   external_url, attached_event, attached_post{...}, attached_post_url.
# ---------------------------------------------------------------------------

def parse_scrapeforge_facebook_post(item: dict) -> Post:
    post_url = _first(item, "url", default="")
    post_id = str(_first(item, "post_id", default="")) or (
        _hash_id(post_url) if post_url else ""
    )

    posted_at = (
        _parse_dt(item.get("timestamp"))
        or datetime.fromtimestamp(0, tz=timezone.utc)
    )

    author = item.get("author") or {}
    if not isinstance(author, dict):
        author = {}
    channel_id = str(_first(author, "id", default=""))
    channel_handle = _first(author, "name", default="")

    media_urls: list[str] = []
    image = item.get("image")
    if isinstance(image, str) and image:
        media_urls.append(image)
    elif isinstance(image, dict):
        url = image.get("url") or image.get("uri")
        if url:
            media_urls.append(url)
    video = item.get("video")
    if isinstance(video, str) and video:
        media_urls.append(video)
    elif isinstance(video, dict):
        url = video.get("url") or video.get("uri")
        if url:
            media_urls.append(url)
    video_files = item.get("video_files")
    if isinstance(video_files, list):
        for v in video_files:
            if isinstance(v, dict):
                u = v.get("url") or v.get("uri")
                if u:
                    media_urls.append(u)
            elif isinstance(v, str):
                media_urls.append(v)

    has_video = bool(item.get("video") or item.get("video_files") or item.get("video_thumbnail"))
    post_type = "video" if has_video else ("image" if media_urls else "text")

    reactions = item.get("reactions") or {}
    if not isinstance(reactions, dict):
        reactions = {}
    likes_total = _safe_int(item.get("reactions_count"))
    if likes_total is None and reactions:
        # Sum across reaction kinds when reactions_count is missing.
        likes_total = sum(_safe_int(v) or 0 for v in reactions.values())

    return Post(
        post_id=post_id,
        platform="facebook",
        channel_handle=str(channel_handle),
        channel_id=channel_id or None,
        title=None,
        content=_first(item, "message", "message_rich", default=""),
        post_url=post_url,
        posted_at=posted_at,
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=likes_total,
        shares=_safe_int(item.get("reshare_count")),
        comments_count=_safe_int(item.get("comments_count")),
        views=None,
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "facebook",
            "type": item.get("type"),
            "reactions": reactions,
            "associated_group_id": item.get("associated_group_id"),
            "external_url": item.get("external_url"),
            "attached_post_url": item.get("attached_post_url"),
        },
        crawl_provider="apify",
    )


def parse_scrapeforge_facebook_channel(item: dict) -> Channel:
    author = item.get("author") or {}
    if not isinstance(author, dict):
        author = {}
    return Channel(
        channel_id=str(_first(author, "id", default="")),
        platform="facebook",
        channel_handle=str(_first(author, "name", default="")),
        subscribers=None,
        total_posts=None,
        channel_url=_first(author, "url", default=None),
        description=None,
        created_date=None,
        channel_metadata={
            "profile_picture_url": author.get("profile_picture_url"),
            "author_title": item.get("author_title"),
        },
    )


# ---------------------------------------------------------------------------
# TikTok — clockworks/tiktok-scraper
# Sample dataset shape:
#   id, text, textLanguage, createTime (unix), createTimeISO, isAd, isPinned,
#   isSlideshow, webVideoUrl, mediaUrls[], slideshowImageLinks[],
#   authorMeta{id, name, nickName, profileUrl, avatar, fans, video, heart,
#              digg, verified, signature, ...},
#   videoMeta{height, width, duration, coverUrl, downloadAddr},
#   musicMeta{musicName, musicAuthor, ...},
#   diggCount, shareCount, commentCount, playCount, collectCount, repostCount,
#   hashtags[{name, ...}], mentions[], detailedMentions[], effectStickers[],
#   searchQuery (echo of query that produced the result).
# ---------------------------------------------------------------------------

def parse_clockworks_tiktok_post(item: dict) -> Post:
    post_id = str(_first(item, "id", default=""))
    post_url = _first(item, "webVideoUrl", default="")
    if not post_id and post_url:
        post_id = _hash_id(post_url)

    posted_at = (
        _parse_dt(_first(item, "createTimeISO", "createTime"))
        or datetime.fromtimestamp(0, tz=timezone.utc)
    )

    author = item.get("authorMeta") or {}
    if not isinstance(author, dict):
        author = {}
    channel_handle = _first(author, "name", default="")
    channel_id = str(_first(author, "id", default=""))

    video_meta = item.get("videoMeta") or {}
    if not isinstance(video_meta, dict):
        video_meta = {}

    media_urls: list[str] = []
    cover = video_meta.get("coverUrl")
    if cover:
        media_urls.append(cover)
    download = video_meta.get("downloadAddr")
    if download:
        media_urls.append(download)
    media_field = item.get("mediaUrls")
    if isinstance(media_field, list):
        media_urls.extend(u for u in media_field if isinstance(u, str))

    is_slideshow = bool(item.get("isSlideshow"))
    post_type = "carousel" if is_slideshow else "video"

    return Post(
        post_id=post_id,
        platform="tiktok",
        channel_handle=str(channel_handle),
        channel_id=channel_id or None,
        title=None,
        content=_first(item, "text", default=""),
        post_url=post_url,
        posted_at=posted_at,
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(item.get("diggCount")),
        shares=_safe_int(item.get("shareCount")),
        comments_count=_safe_int(item.get("commentCount")),
        views=_safe_int(item.get("playCount")),
        saves=_safe_int(item.get("collectCount")),
        comments=[],
        platform_metadata={
            "platform": "tiktok",
            "duration_sec": video_meta.get("duration"),
            "music_name": (item.get("musicMeta") or {}).get("musicName"),
            "music_author": (item.get("musicMeta") or {}).get("musicAuthor"),
            "hashtags": [
                (h.get("name") if isinstance(h, dict) else h)
                for h in (item.get("hashtags") or [])
            ],
            "is_ad": item.get("isAd"),
            "is_slideshow": is_slideshow,
            "search_query": item.get("searchQuery"),
            "text_language": item.get("textLanguage"),
        },
        crawl_provider="apify",
    )


def parse_clockworks_tiktok_channel(item: dict) -> Channel:
    author = item.get("authorMeta") or {}
    if not isinstance(author, dict):
        author = {}
    handle = _first(author, "name", default="")
    return Channel(
        channel_id=str(_first(author, "id", default="")),
        platform="tiktok",
        channel_handle=str(handle),
        subscribers=_safe_int(_first(author, "fans", "followerCount")),
        total_posts=_safe_int(_first(author, "video", "videoCount")),
        channel_url=_first(author, "profileUrl", default=None)
        or (f"https://www.tiktok.com/@{handle}" if handle else None),
        description=author.get("signature"),
        created_date=None,
        channel_metadata={
            "verified": author.get("verified"),
            "nickname": author.get("nickName"),
            "avatar_url": author.get("avatar"),
        },
    )


# ---------------------------------------------------------------------------
# Registry — keyed by (platform, actor_id). v1 ships one parser per platform;
# adding a new actor for an existing platform requires registering a parser
# entry here. ApifyAdapter raises at init time if a configured actor lacks one.
# ---------------------------------------------------------------------------

_PARSER_REGISTRY: dict[tuple[str, str], tuple[ParsePostFn, ParseChannelFn]] = {
    ("instagram", "apify/instagram-scraper"): (
        parse_apify_instagram_post,
        parse_apify_instagram_channel,
    ),
    ("facebook", "scrapeforge/facebook-search-posts"): (
        parse_scrapeforge_facebook_post,
        parse_scrapeforge_facebook_channel,
    ),
    ("tiktok", "clockworks/tiktok-scraper"): (
        parse_clockworks_tiktok_post,
        parse_clockworks_tiktok_channel,
    ),
}


def get_parsers(platform: str, actor_id: str) -> tuple[ParsePostFn, ParseChannelFn]:
    """Look up the (post_parser, channel_parser) pair for the given platform/actor.

    Raises ValueError when no entry exists — call this at adapter init so
    misconfiguration surfaces before the first crawl.
    """
    key = (platform, actor_id)
    if key not in _PARSER_REGISTRY:
        registered = sorted(_PARSER_REGISTRY.keys())
        raise ValueError(
            f"No Apify parser registered for platform={platform!r} actor={actor_id!r}. "
            f"Registered: {registered}. To use a new actor, add an entry to "
            f"_PARSER_REGISTRY in workers/collection/adapters/apify_parsers.py."
        )
    return _PARSER_REGISTRY[key]
