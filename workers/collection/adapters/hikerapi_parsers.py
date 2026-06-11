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
    taken_at (int epoch on reels SERP; ISO-8601 string + int `taken_at_ts` on
    hashtag_medias_*_chunk_v1), media_type (1=image, 2=video, 8=carousel),
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


def _to_utc(value: Any) -> datetime | None:
    """Parse one HikerAPI timestamp value -> tz-aware UTC datetime, or None.

    Handles every shape the IG surfaces actually return:
      - int/float epoch seconds      (fbsearch_reels_v2 `taken_at`)
      - numeric string epoch         (`taken_at_ts` arrives as int, kept for safety)
      - ISO-8601 string e.g. '...Z'  (hashtag_medias_*_chunk_v1 `taken_at`)
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
        # Numeric string -> epoch seconds. ISO strings ('2026-...') raise here
        # and fall through to fromisoformat below.
        try:
            return datetime.fromtimestamp(float(s), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            pass
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _resolve_taken_at(item: dict) -> datetime:
    """Resolve a post's timestamp from an IG media object.

    The chunk endpoints (hashtag_medias_*_chunk_v1) return `taken_at` as an
    ISO-8601 STRING plus an int epoch in `taken_at_ts`; the reels SERP returns
    `taken_at` as an int epoch and no `taken_at_ts`. Prefer the unambiguous int
    epoch, then fall back to whatever `taken_at` parses to. Epoch 0 means
    "unknown" - and because the collection time-window filter drops 1970-dated
    posts, an unparseable timestamp silently discards the post, so log it loudly.
    """
    for key in ("taken_at_ts", "taken_at"):
        dt = _to_utc(item.get(key))
        if dt is not None:
            return dt
    logger.warning(
        "hikerapi: unparseable taken_at (taken_at=%r taken_at_ts=%r) for media pk=%s",
        item.get("taken_at"), item.get("taken_at_ts"), item.get("pk"),
    )
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
        posted_at=_resolve_taken_at(item),
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
