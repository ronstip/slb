"""Transform HikerAPI Instagram responses into Post/Channel model instances.

HikerAPI returns native Instagram private-API media objects (snake_case) - the
same shape Vetric's IG endpoints return - so these parsers mirror
``vetric_parsers.parse_instagram_*`` but add the reels-SERP-specific field
fallbacks (``ig_play_count`` / ``view_count`` for views, ``caption_text`` for
caption, ``product_type`` for the media kind).

The reels SERP surface (``fbsearch_reels_v2``) returns reels/video only.

Native media shape (relevant keys):
    pk / id, code, like_count, comment_count,
    play_count / ig_play_count / view_count, caption{text} | caption_text,
    user{pk, username, full_name, is_verified, follower_count, ...},
    taken_at (epoch seconds), media_type (1=image, 2=video, 8=carousel),
    product_type ("clips" | "feed" | "igtv" | ...).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from workers.collection.models import Channel, Post

logger = logging.getLogger(__name__)

# media_type integer codes (IG private API).
_MEDIA_TYPE_MAP = {1: "image", 2: "video", 8: "carousel"}
# product_type strings that are always video reels.
_VIDEO_PRODUCT_TYPES = {"clips", "reels", "igtv", "feed_video"}


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _epoch_to_utc(value: Any) -> datetime:
    """Epoch seconds (int, float, OR string - the v1 hashtag chunk endpoints
    return taken_at as a string) -> tz-aware UTC datetime; epoch 0 on garbage."""
    try:
        ts = float(value)
    except (TypeError, ValueError):
        ts = 0.0
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OSError, OverflowError, ValueError):
        return datetime.fromtimestamp(0, tz=timezone.utc)


def _first_int(item: dict, *keys: str) -> int | None:
    """First non-None int among the listed keys."""
    for key in keys:
        v = _safe_int(item.get(key))
        if v is not None:
            return v
    return None


def _hash_id(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]


def _caption_text(item: dict) -> str:
    caption = item.get("caption")
    if isinstance(caption, dict):
        return caption.get("text") or ""
    # Some shapes carry the text at the top level instead of a nested object.
    return item.get("caption_text") or (caption if isinstance(caption, str) else "") or ""


def _post_type(item: dict) -> str:
    product_type = (item.get("product_type") or "").lower()
    if product_type in _VIDEO_PRODUCT_TYPES:
        return "video"
    return _MEDIA_TYPE_MAP.get(_safe_int(item.get("media_type")), "video")


def _media_urls(item: dict) -> list[str]:
    """Best-effort image/video URLs from a native IG media object.

    IMAGE FIRST, then video - the display thumbnail is media_urls[0] (the media
    downloader builds media_refs in order, and the feed renders the first ref as
    the poster image). Mirrors the apify IG parser's displayUrl-first ordering.
    The video URL (.mp4) follows so reels still get downloaded for enrichment.
    """
    urls: list[str] = []
    candidates = (item.get("image_versions2") or {}).get("candidates") or []
    if isinstance(candidates, list) and candidates:
        u = (candidates[0] or {}).get("url")
        if u:
            urls.append(u)
    thumb = item.get("thumbnail_url")
    if thumb and thumb not in urls:
        urls.append(thumb)
    video_versions = item.get("video_versions") or []
    if isinstance(video_versions, list) and video_versions:
        u = (video_versions[0] or {}).get("url")
        if u:
            urls.append(u)
    return urls


def parse_hikerapi_instagram_post(item: dict) -> Post:
    """Parse one native IG media object from a HikerAPI reels SERP."""
    code = item.get("code") or item.get("shortcode") or ""
    post_url = f"https://www.instagram.com/p/{code}/" if code else ""
    # Use /p/{code}/ (not /reel/) so the URL matches the canonical form Apify /
    # Vetric emit - keeps cross-provider dedup + engagement-refresh-by-URL working.
    post_id = str(item.get("pk") or item.get("id") or "") or (_hash_id(post_url) if post_url else "")

    user = item.get("user") or {}

    views = _first_int(item, "play_count", "ig_play_count", "view_count", "video_view_count")
    post_type = _post_type(item)

    return Post(
        post_id=post_id,
        platform="instagram",
        channel_handle=user.get("username", ""),
        channel_id=str(user.get("pk") or user.get("id") or "") or None,
        title=None,
        content=_caption_text(item),
        post_url=post_url,
        posted_at=_epoch_to_utc(item.get("taken_at")),
        post_type=post_type,
        parent_post_id=None,
        media_urls=_media_urls(item),
        media_refs=[],
        likes=_safe_int(item.get("like_count")),
        shares=None,
        comments_count=_safe_int(item.get("comment_count")),
        views=views,
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "instagram",
            "media_type_code": _safe_int(item.get("media_type")),
            "product_type": item.get("product_type"),
            "video_duration": item.get("video_duration"),
            "author": user.get("username"),
        },
        crawl_provider="hikerapi",
    )


def parse_hikerapi_instagram_channel(item: dict) -> Channel:
    """Parse the embedded ``user`` of a HikerAPI media object into a Channel."""
    user = item.get("user") or {}
    username = user.get("username", "")
    return Channel(
        channel_id=str(user.get("pk") or user.get("id") or ""),
        platform="instagram",
        channel_handle=username,
        subscribers=_safe_int(user.get("follower_count")),
        total_posts=_safe_int(user.get("media_count")),
        channel_url=f"https://www.instagram.com/{username}/" if username else None,
        description=user.get("biography"),
        created_date=None,
        channel_metadata={
            "verified": user.get("is_verified", False),
            "full_name": user.get("full_name"),
            "category": user.get("category"),
        },
    )
