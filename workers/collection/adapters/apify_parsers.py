"""Transform Apify actor dataset items into Post/Channel model instances.

Each (platform, actor_id) pair is registered in `_PARSER_REGISTRY`.
ApifyAdapter looks up the parser at init time and fail-fast raises if a
configured actor has no parser entry - swapping actors via env requires
also registering a parser.

Field-name fallbacks: actor outputs occasionally rename or remove keys
between builds, so each parser tries multiple known names via
`_first(item, "key_a", "key_b", ...)`.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from workers.collection.models import Channel, Comment, Post

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

    Always returns tz-aware UTC. Returns None on failure - callers must handle
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
# Instagram - apify/instagram-scraper
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

    # Views: prefer videoPlayCount (more reliable for Reels per actor docs),
    # fall back to videoViewCount, then alternate names some builds emit.
    # Without a logged-in `cookies` input, IG often omits view counts entirely
    # for Reels - that's an upstream constraint, not a parser bug.
    views = _safe_int(_first(
        item, "videoPlayCount", "videoViewCount", "playCount", "videoViews",
    ))
    # Temporarily INFO so the next live test shows whether Apify omits the
    # field or returns null - flip back to logger.debug after we have a
    # confirmed answer in production logs.
    if post_type == "video" and views is None:
        logger.info(
            "[apify/instagram] video post %s missing views (item keys=%s)",
            post_id, sorted(item.keys()),
        )

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
        views=views,
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
# Instagram - apidojo/instagram-hashtag-scraper
# Different output shape from apify/instagram-scraper:
#   - Singular `likeCount` / `commentCount` (vs plural)
#   - Nested `owner.{id,username,fullName,isVerified}` (vs flat owner*)
#   - Nested `video.{playCount,url}` and `image.url` (vs flat displayUrl/videoUrl)
#   - `createdAt` ISO (vs `timestamp`)
#   - All items typed `"post"`; video/carousel encoded via `isVideo`/`isCarousel`
# Strategy: flatten the apidojo shape onto the legacy keys, then delegate to
# `parse_apify_instagram_post` so the field-handling logic stays in one place.
# ---------------------------------------------------------------------------

def _normalize_apidojo_ig_item(item: dict) -> dict:
    out = dict(item)

    owner = item.get("owner")
    if isinstance(owner, dict):
        out.setdefault("ownerUsername", owner.get("username"))
        out.setdefault("ownerId", owner.get("id"))
        out.setdefault("ownerFullName", owner.get("fullName"))
        out.setdefault("ownerIsVerified", owner.get("isVerified"))

    video = item.get("video")
    if isinstance(video, dict):
        if out.get("videoPlayCount") is None and video.get("playCount") is not None:
            out["videoPlayCount"] = video["playCount"]
        if not out.get("videoUrl") and video.get("url"):
            out["videoUrl"] = video["url"]

    image = item.get("image")
    if isinstance(image, dict):
        if not out.get("displayUrl") and image.get("url"):
            out["displayUrl"] = image["url"]

    if out.get("likesCount") is None and "likeCount" in item:
        out["likesCount"] = item["likeCount"]
    if out.get("commentsCount") is None and "commentCount" in item:
        out["commentsCount"] = item["commentCount"]

    if not out.get("timestamp") and item.get("createdAt"):
        out["timestamp"] = item["createdAt"]

    # Map apidojo's boolean flags onto the legacy `type` strings the
    # _IG_TYPE_MAP recognizes. apidojo emits type="post" for everything.
    if str(out.get("type", "")).lower() == "post":
        if item.get("isVideo"):
            out["type"] = "Video"
        elif item.get("isCarousel"):
            out["type"] = "Sidecar"
        else:
            out["type"] = "Image"

    return out


def parse_apidojo_ig_hashtag_post(item: dict) -> Post:
    return parse_apify_instagram_post(_normalize_apidojo_ig_item(item))


def parse_apidojo_ig_hashtag_channel(item: dict) -> Channel:
    return parse_apify_instagram_channel(_normalize_apidojo_ig_item(item))


# ---------------------------------------------------------------------------
# Facebook - scrapeforge/facebook-search-posts
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
# Facebook (channel/page) - apify/facebook-posts-scraper
# Collects a specific page/profile's feed from `startUrls` (page URLs), unlike
# the keyword actor (scrapeforge/facebook-search-posts) which takes a `query`.
# Output schema differs from scrapeforge, so it gets its own parser. Field-name
# fallbacks cover known build variations:
#   postId / post_id, url / topLevelUrl / postUrl, text / message,
#   time (ISO) / timestamp (unix sec) / date, user{id,name,profileUrl} / pageName,
#   likes / reactionsCount (+ likesCount), comments / commentsCount,
#   shares / sharesCount / reshareCount, media[] / attachments[].
# ---------------------------------------------------------------------------

def parse_apify_facebook_page_post(item: dict) -> Post:
    post_url = _first(item, "url", "topLevelUrl", "postUrl", "facebookUrl", default="")
    post_id = str(_first(item, "postId", "post_id", "id", default="")) or (
        _hash_id(post_url) if post_url else ""
    )

    posted_at = (
        _parse_dt(_first(item, "timestamp", "time", "date", "publishedTime"))
        or datetime.fromtimestamp(0, tz=timezone.utc)
    )

    user = item.get("user")
    if not isinstance(user, dict):
        user = {}
    channel_id = str(_first(user, "id", default="") or item.get("pageId") or "")
    channel_handle = _first(
        user, "name", default=_first(item, "pageName", "userName", default=""),
    )

    media_urls: list[str] = []
    media = item.get("media")
    if isinstance(media, list):
        for m in media:
            if isinstance(m, str):
                media_urls.append(m)
            elif isinstance(m, dict):
                photo = m.get("photo_image") if isinstance(m.get("photo_image"), dict) else {}
                u = m.get("thumbnail") or photo.get("uri") or m.get("url") or m.get("uri")
                if u:
                    media_urls.append(u)
    # Single image/video fields some builds emit alongside / instead of media[].
    for key in ("imageUrl", "image", "thumbnailUrl"):
        val = item.get(key)
        if isinstance(val, str) and val:
            media_urls.append(val)

    has_video = bool(
        item.get("videoUrl") or item.get("video")
        or str(_first(item, "type", default="")).lower() in ("video", "reel")
    )
    post_type = "video" if has_video else ("image" if media_urls else "text")

    return Post(
        post_id=post_id,
        platform="facebook",
        channel_handle=str(channel_handle),
        channel_id=channel_id or None,
        title=None,
        content=_first(item, "text", "message", default=""),
        post_url=post_url,
        posted_at=posted_at,
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(_first(item, "likes", "reactionsCount", "likesCount", default=None)),
        shares=_safe_int(_first(item, "shares", "sharesCount", "reshareCount", default=None)),
        comments_count=_safe_int(_first(item, "comments", "commentsCount", default=None)),
        views=_safe_int(_first(item, "viewsCount", "videoViewCount", default=None)),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "facebook",
            "type": item.get("type"),
            "page_name": item.get("pageName"),
            "facebook_url": item.get("facebookUrl"),
            "input_url": _first(item, "inputUrl", "facebookUrl", default=None),
        },
        crawl_provider="apify",
    )


def parse_apify_facebook_page_channel(item: dict) -> Channel:
    user = item.get("user")
    if not isinstance(user, dict):
        user = {}
    handle = _first(user, "name", default=_first(item, "pageName", default=""))
    return Channel(
        channel_id=str(_first(user, "id", default="") or item.get("pageId") or ""),
        platform="facebook",
        channel_handle=str(handle),
        subscribers=_safe_int(_first(item, "pageLikes", "likes", default=None))
        if not item.get("user") else None,
        total_posts=None,
        channel_url=_first(user, "profileUrl", default=None)
        or _first(item, "facebookUrl", default=None),
        description=None,
        created_date=None,
        channel_metadata={
            "page_name": item.get("pageName"),
        },
    )


# ---------------------------------------------------------------------------
# Facebook (group) - apify/facebook-groups-scraper
# Collects a group's feed from `startUrls` (group URLs). The page actor
# (apify/facebook-posts-scraper) returns NO-DATA for group feeds, so group URLs
# get their own actor + parser. Unlike pages, the "channel" is the GROUP, not
# the member who posted - so channel identity maps to groupId/groupTitle and the
# poster lands in platform_metadata.author. Field-name fallbacks cover known
# build variations:
#   postId / post_id, url / topLevelUrl / postUrl / facebookUrl, text / message,
#   time (ISO) / timestamp (unix sec) / date, groupId / groupTitle (+ url path),
#   user/author{id,name,profileUrl}, likes / reactionsCount, comments /
#   commentsCount, shares / sharesCount, media[] / attachments[].
# ---------------------------------------------------------------------------

def _fb_group_id_from_url(url: str | None) -> str:
    """Extract the group id from a facebook.com/groups/<id> URL ("" if absent)."""
    m = re.search(r"/groups/([^/?#]+)", url or "")
    return m.group(1) if m else ""


def _fb_group_identity(item: dict) -> tuple[str, str, str]:
    """Return (group_id, group_title, group_url) for a groups-actor item."""
    group_url = _first(item, "facebookUrl", "groupUrl", "inputUrl", "url", "topLevelUrl", default="")
    group_id = str(
        # `facebookId` is the canonical numeric group id the groups actor emits;
        # the URL fallback may yield a slug (e.g. /groups/smartflights/).
        _first(item, "groupId", "group_id", "facebookId", default="")
        or _fb_group_id_from_url(group_url)
    )
    group_title = str(_first(item, "groupTitle", "groupName", "pageName", default=""))
    return group_id, group_title, group_url


# Literal display names the Apify groups actor emits for anonymous posters.
# Real anon posts arrive as user={"name": "Anonymous participant", "id": <id>}
# (a distinct id per post), NOT a missing author block - so we must catch the
# name marker, not just absence, or every anon poster collapses into one
# "Anonymous participant" channel across all groups.
_FB_ANON_NAME_MARKERS = {"anonymous participant", "anonymous member", "anonymous"}


def _fb_group_author(item: dict, group_title: str) -> tuple[str, str | None, str | None, bool]:
    """Return (channel_handle, channel_id, channel_url, is_anonymous) for a
    group-post item.

    Channel == the member who wrote the post, NOT the group it lives in (the
    group is carried in platform_metadata instead). FB groups allow anonymous
    posting; for anon posts (absent author block, or the actor's literal
    "Anonymous participant" marker) we use a per-group "Anonymous · <group>"
    handle so anon posters from different groups don't collapse into one
    synthetic channel. The actor's per-post author id (when present) is kept so
    distinct anon posters stay distinct rows.
    """
    author = item.get("user")
    if not isinstance(author, dict):
        author = item.get("author") if isinstance(item.get("author"), dict) else {}

    name = _first(author, "name", "title", default=None)
    author_id = str(_first(author, "id", "userId", default="")) or None
    author_url = _first(author, "profileUrl", "url", "profile_url", default=None)

    is_anonymous = name is None or str(name).strip().lower() in _FB_ANON_NAME_MARKERS
    if not is_anonymous:
        return str(name), author_id, author_url, False
    anon_handle = f"Anonymous · {group_title}" if group_title else "Anonymous"
    return anon_handle, author_id, None, True


def parse_apify_facebook_group_post(item: dict) -> Post:
    post_url = _first(item, "url", "topLevelUrl", "postUrl", "facebookUrl", default="")
    post_id = str(_first(item, "postId", "post_id", "id", default="")) or (
        _hash_id(post_url) if post_url else ""
    )

    posted_at = (
        _parse_dt(_first(item, "timestamp", "time", "date", "publishedTime"))
        or datetime.fromtimestamp(0, tz=timezone.utc)
    )

    group_id, group_title, group_url = _fb_group_identity(item)
    author_handle, author_id, _author_url, is_anonymous = _fb_group_author(item, group_title)

    media_urls: list[str] = []
    media = item.get("media")
    if isinstance(media, list):
        for m in media:
            if isinstance(m, str):
                media_urls.append(m)
            elif isinstance(m, dict):
                photo = m.get("photo_image") if isinstance(m.get("photo_image"), dict) else {}
                u = m.get("thumbnail") or photo.get("uri") or m.get("url") or m.get("uri")
                if u:
                    media_urls.append(u)
    for key in ("imageUrl", "image", "thumbnailUrl"):
        val = item.get(key)
        if isinstance(val, str) and val:
            media_urls.append(val)

    has_video = bool(
        item.get("videoUrl") or item.get("video")
        or str(_first(item, "type", default="")).lower() in ("video", "reel")
    )
    post_type = "video" if has_video else ("image" if media_urls else "text")

    return Post(
        post_id=post_id,
        platform="facebook",
        # Channel == the member who wrote the post; the group lives in metadata.
        channel_handle=author_handle,
        channel_id=author_id,
        title=None,
        content=_first(item, "text", "message", default=""),
        post_url=post_url,
        posted_at=posted_at,
        post_type=post_type,
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=_safe_int(_first(item, "likes", "reactionsCount", "likesCount", default=None)),
        shares=_safe_int(_first(item, "shares", "sharesCount", "reshareCount", default=None)),
        comments_count=_safe_int(_first(item, "comments", "commentsCount", default=None)),
        views=_safe_int(_first(item, "viewsCount", "videoViewCount", default=None)),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "facebook",
            "type": item.get("type"),
            "group_id": group_id or None,
            "group_title": group_title or None,
            "group_url": group_url or None,
            "author_id": author_id,
            "author_name": None if is_anonymous else author_handle,
            "is_anonymous": is_anonymous,
            "facebook_url": item.get("facebookUrl"),
            "input_url": _first(item, "inputUrl", "facebookUrl", default=None),
        },
        crawl_provider="apify",
    )


def parse_apify_facebook_group_channel(item: dict) -> Channel:
    """Channel snapshot for a group post == the author, matching post.channel_id.
    The group it was posted in is preserved in channel_metadata."""
    group_id, group_title, group_url = _fb_group_identity(item)
    author_handle, author_id, author_url, _is_anonymous = _fb_group_author(item, group_title)
    return Channel(
        channel_id=author_id or "",
        platform="facebook",
        channel_handle=author_handle,
        subscribers=None,
        total_posts=None,
        channel_url=author_url or None,
        description=None,
        created_date=None,
        channel_metadata={
            "group_id": group_id or None,
            "group_title": group_title or None,
            "group_url": group_url or None,
        },
    )


# ---------------------------------------------------------------------------
# TikTok - clockworks/tiktok-scraper
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
# Registry - keyed by (platform, actor_id). v1 ships one parser per platform;
# adding a new actor for an existing platform requires registering a parser
# entry here. ApifyAdapter raises at init time if a configured actor lacks one.
# ---------------------------------------------------------------------------

_PARSER_REGISTRY: dict[tuple[str, str], tuple[ParsePostFn, ParseChannelFn]] = {
    ("instagram", "apify/instagram-scraper"): (
        parse_apify_instagram_post,
        parse_apify_instagram_channel,
    ),
    ("instagram", "apidojo/instagram-hashtag-scraper"): (
        parse_apidojo_ig_hashtag_post,
        parse_apidojo_ig_hashtag_channel,
    ),
    ("facebook", "scrapeforge/facebook-search-posts"): (
        parse_scrapeforge_facebook_post,
        parse_scrapeforge_facebook_channel,
    ),
    ("facebook", "apify/facebook-posts-scraper"): (
        parse_apify_facebook_page_post,
        parse_apify_facebook_page_channel,
    ),
    ("facebook", "apify/facebook-groups-scraper"): (
        parse_apify_facebook_group_post,
        parse_apify_facebook_group_channel,
    ),
    ("tiktok", "clockworks/tiktok-scraper"): (
        parse_clockworks_tiktok_post,
        parse_clockworks_tiktok_channel,
    ),
}


# ---------------------------------------------------------------------------
# Instagram comments - apify/instagram-comment-scraper
# Dataset item shape (top-level reply on a post):
#   id, text, ownerUsername, ownerProfilePicUrl, ownerIsVerified, timestamp,
#   likesCount, repliesCount, replies (nested list of same shape, optional),
#   postUrl (echo), commentUrl
# Nested replies carry a `parentCommentId` (or `replyToCommentId`) on builds
# that flatten them; builds that nest replies under `replies` get their
# parent stamped during the flatten step below.
# ---------------------------------------------------------------------------

def parse_apify_instagram_comment(item: dict, parent_comment_id: str | None = None) -> Comment:
    """Parse one IG comment item into a Comment.

    `parent_comment_id`, when set, overrides any value on the item itself -
    used by the flattener to stamp the correct parent on nested replies that
    don't carry their parent id natively.
    """
    comment_id = str(_first(item, "id", "commentId", default=""))
    handle = _first(item, "ownerUsername", "username", default="")
    owner_id = _first(item, "ownerId", "userId", default=None)

    commented_at = _parse_dt(_first(item, "timestamp", "createdAt", "created_at"))

    replied_to = parent_comment_id or _first(
        item, "parentCommentId", "replyToCommentId", "parentId", default=None,
    )

    return Comment(
        comment_id=comment_id,
        platform="instagram",
        channel_handle=str(handle),
        channel_id=str(owner_id) if owner_id else None,
        content=_first(item, "text", "content", default=""),
        commented_at=commented_at or datetime.fromtimestamp(0, tz=timezone.utc),
        likes=_safe_int(item.get("likesCount")),
        replies_count=_safe_int(item.get("repliesCount")),
        media_urls=[],
        media_refs=[],
        platform_metadata={
            "platform": "instagram",
            "owner_is_verified": item.get("ownerIsVerified"),
            "owner_profile_pic_url": item.get("ownerProfilePicUrl"),
            "comment_url": item.get("commentUrl"),
        },
        replied_to_id=str(replied_to) if replied_to else None,
    )


def parse_apify_instagram_comment_author(item: dict) -> Channel:
    """Channel snapshot for a comment author."""
    handle = _first(item, "ownerUsername", "username", default="")
    owner_id = _first(item, "ownerId", "userId", default="")
    return Channel(
        channel_id=str(owner_id),
        platform="instagram",
        channel_handle=str(handle),
        subscribers=None,
        total_posts=None,
        channel_url=f"https://www.instagram.com/{handle}/" if handle else None,
        description=None,
        created_date=None,
        channel_metadata={
            "verified": item.get("ownerIsVerified"),
            "profile_pic_url": item.get("ownerProfilePicUrl"),
        },
    )


def flatten_apify_instagram_comments(
    items: list[dict], post_id: str,
) -> list[Comment]:
    """Walk top-level items + their nested `replies` and emit a flat list of
    Comments with `replied_to_id` correctly populated for each reply.

    Each top-level comment gets `replied_to_id = post_id` so the threading
    pass treats it as a direct reply to the post (root = self). Nested
    replies get `replied_to_id = <top-level comment id>`.
    """
    out: list[Comment] = []
    for top in items:
        top_comment = parse_apify_instagram_comment(top, parent_comment_id=post_id)
        if not top_comment.comment_id:
            continue
        out.append(top_comment)
        replies = top.get("replies") or []
        if not isinstance(replies, list):
            continue
        for reply in replies:
            if not isinstance(reply, dict):
                continue
            child = parse_apify_instagram_comment(
                reply, parent_comment_id=top_comment.comment_id,
            )
            if child.comment_id:
                out.append(child)
    return out


# ---------------------------------------------------------------------------
# TikTok comments - clockworks/tiktok-comments-scraper
# Dataset item shape (top-level comment on a video):
#   cid, text, create_time (unix sec), digg_count (likes), reply_comment_total,
#   reply_id ("0" or absent = top-level, otherwise parent cid),
#   user { unique_id, nickname, uid, avatar_thumb, sec_uid, verified },
#   replies[] (nested list of same shape; some builds return top-level only +
#   require a separate reply-scraper actor - handled defensively).
# ---------------------------------------------------------------------------

def parse_apify_tiktok_comment(item: dict, parent_comment_id: str | None = None) -> Comment:
    """Parse one TikTok comment item into a Comment.

    `parent_comment_id`, when set, overrides any value on the item itself -
    used by the flattener to stamp the correct parent on nested replies.
    """
    comment_id = str(_first(item, "cid", "id", "commentId", default=""))

    user = item.get("user") or {}
    if not isinstance(user, dict):
        user = {}
    handle = _first(user, "unique_id", "uniqueId", "username") or _first(
        item, "uniqueId", "username", default="",
    )
    owner_id = _first(user, "uid", "id", "userId") or _first(
        item, "uid", "userId", default=None,
    )

    commented_at = _parse_dt(_first(item, "create_time", "createTime", "createdAt", "timestamp"))

    # TikTok marks top-level comments with reply_id="0" or missing.
    raw_parent = parent_comment_id
    if raw_parent is None:
        candidate = _first(item, "reply_id", "replyId", "parentCommentId", "parentId", default=None)
        if candidate and str(candidate) != "0":
            raw_parent = candidate

    return Comment(
        comment_id=comment_id,
        platform="tiktok",
        channel_handle=str(handle),
        channel_id=str(owner_id) if owner_id else None,
        content=_first(item, "text", "content", default=""),
        commented_at=commented_at or datetime.fromtimestamp(0, tz=timezone.utc),
        likes=_safe_int(_first(item, "digg_count", "diggCount", "likesCount")),
        replies_count=_safe_int(_first(item, "reply_comment_total", "replyCommentTotal", "repliesCount")),
        media_urls=[],
        media_refs=[],
        platform_metadata={
            "platform": "tiktok",
            "verified": user.get("verified"),
            "nickname": user.get("nickname"),
            "avatar_url": _first(user, "avatar_thumb", "avatarThumb", "avatar"),
            "sec_uid": user.get("sec_uid") or user.get("secUid"),
        },
        replied_to_id=str(raw_parent) if raw_parent else None,
    )


def parse_apify_tiktok_comment_author(item: dict) -> Channel:
    """Channel snapshot for a TikTok comment author."""
    user = item.get("user") or {}
    if not isinstance(user, dict):
        user = {}
    handle = _first(user, "unique_id", "uniqueId", "username") or _first(
        item, "uniqueId", "username", default="",
    )
    owner_id = _first(user, "uid", "id", "userId") or _first(
        item, "uid", "userId", default="",
    )
    return Channel(
        channel_id=str(owner_id),
        platform="tiktok",
        channel_handle=str(handle),
        subscribers=None,
        total_posts=None,
        channel_url=f"https://www.tiktok.com/@{handle}" if handle else None,
        description=None,
        created_date=None,
        channel_metadata={
            "verified": user.get("verified"),
            "nickname": user.get("nickname"),
            "avatar_url": _first(user, "avatar_thumb", "avatarThumb", "avatar"),
        },
    )


def flatten_apify_tiktok_comments(items: list[dict], post_id: str) -> list[Comment]:
    """Walk top-level items + their nested `replies` and emit a flat list of
    Comments with `replied_to_id` correctly populated for each reply.

    Top-level: `replied_to_id = post_id` (root = self after threading pass).
    Nested replies: `replied_to_id = <top-level cid>`.

    When an item arrives flat with a non-zero `reply_id` (some actor builds
    return replies in the same list as top-level comments rather than
    nested), the item's own `reply_id` is preserved as the parent linkage.
    """
    out: list[Comment] = []
    for top in items:
        # Respect the item's own reply_id if it indicates a non-top-level
        # comment; otherwise treat as a direct reply to the post.
        raw_reply_id = _first(top, "reply_id", "replyId", default=None)
        is_flat_reply = raw_reply_id is not None and str(raw_reply_id) != "0"

        top_comment = parse_apify_tiktok_comment(
            top, parent_comment_id=None if is_flat_reply else post_id,
        )
        if not top_comment.comment_id:
            continue
        out.append(top_comment)

        replies = top.get("replies") or []
        if not isinstance(replies, list):
            continue
        for reply in replies:
            if not isinstance(reply, dict):
                continue
            child = parse_apify_tiktok_comment(
                reply, parent_comment_id=top_comment.comment_id,
            )
            if child.comment_id:
                out.append(child)
    return out


# ---------------------------------------------------------------------------
# YouTube comments - streamers/youtube-comments-scraper
# Observed dataset item shape (one comment per item; no native id, no
# channelId - only handle):
#   author ("@handle"), comment, type ("comment" | "reply"),
#   voteCount, replyCount, publishedTimeText ("2 hours ago"),
#   hasCreatorHeart, authorIsChannelOwner, title, pageUrl.
# Field-name fallbacks cover other builds that emit text under `text`/
# `commentText`, ids under `commentId`/`cid`, ISO dates under `publishedAt`,
# UC-style channel ids under `authorChannelId`/`channelId`.
# ---------------------------------------------------------------------------

_YT_RELATIVE_UNITS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86_400,
    "week": 7 * 86_400,
    "month": 30 * 86_400,   # approx - YT only ever shows whole units
    "year": 365 * 86_400,
}

_YT_RELATIVE_RE = re.compile(
    r"\b(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b",
)


def _parse_yt_relative_time(text: Any, ref_now: datetime) -> datetime | None:
    """Convert YT's `publishedTimeText` (e.g. "2 hours ago", "a day ago",
    "just now") into an absolute tz-aware UTC datetime relative to `ref_now`.

    YT only ever emits relative times for comments via this actor, so a
    timezone-aware "now" anchor is the best we can do - the result is
    approximate to whole units (YT's own granularity).
    """
    if not isinstance(text, str):
        return None
    s = text.strip().lower()
    if not s:
        return None
    if s in ("just now", "moments ago"):
        return ref_now
    if s == "yesterday":
        return ref_now - timedelta(days=1)
    m = _YT_RELATIVE_RE.search(s)
    if not m:
        return None
    raw_n, unit = m.group(1), m.group(2)
    n = 1 if raw_n in ("a", "an") else int(raw_n)
    return ref_now - timedelta(seconds=n * _YT_RELATIVE_UNITS[unit])


def _parse_yt_vote_count(value: Any) -> int | None:
    """YT actors sometimes return abbreviated strings like '1.2K' or '3M'.

    Numeric values pass through `_safe_int`. Strings: strip commas, then
    expand K/M/B suffix; fall back to None on parse failure.
    """
    if isinstance(value, (int, float)):
        return _safe_int(value)
    if not isinstance(value, str):
        return None
    s = value.strip().replace(",", "")
    if not s:
        return None
    mult = 1
    suffix = s[-1].upper()
    if suffix in ("K", "M", "B"):
        mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[suffix]
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except ValueError:
        return None


def _yt_handle(item: dict) -> str:
    """Pull the author handle (no leading "@") from any of the known fields."""
    handle = _first(
        item, "authorHandle", "authorChannelHandle", "author", "userName",
        "authorName", default="",
    )
    if isinstance(handle, str) and handle.startswith("@"):
        handle = handle[1:]
    return str(handle)


def parse_apify_youtube_comment(
    item: dict,
    parent_comment_id: str | None = None,
    *,
    ref_now: datetime | None = None,
) -> Comment:
    """Parse one YouTube comment item into a Comment.

    `parent_comment_id`, when set, overrides any value on the item itself -
    used by the flattener to stamp the correct parent on replies.

    `ref_now` is the anchor for parsing relative `publishedTimeText` (e.g.
    "2 hours ago") - pass the same timestamp for every item in a batch so
    threaded comments stay ordered relative to each other.
    """
    if ref_now is None:
        ref_now = datetime.now(tz=timezone.utc)

    comment_id = str(_first(item, "id", "commentId", "cid", default=""))

    handle = _yt_handle(item)
    channel_id = _first(item, "authorChannelId", "channelId", "authorId", default=None)

    content = _first(item, "comment", "text", "commentText", "content", default="")

    published_text = item.get("publishedTimeText")
    commented_at = (
        _parse_dt(_first(item, "publishedAt", "publishedTime", "time", "createdAt"))
        or _parse_yt_relative_time(published_text, ref_now)
    )

    raw_parent = parent_comment_id
    if raw_parent is None:
        candidate = _first(item, "parentCommentId", "replyToCid", "parentId", default=None)
        if candidate:
            raw_parent = candidate

    return Comment(
        comment_id=comment_id,
        platform="youtube",
        channel_handle=handle,
        channel_id=str(channel_id) if channel_id else None,
        content=content,
        commented_at=commented_at or datetime.fromtimestamp(0, tz=timezone.utc),
        likes=_parse_yt_vote_count(_first(item, "voteCount", "votes", "likes", "likeCount", default=None)),
        replies_count=_safe_int(_first(item, "replyCount", "repliesCount", "numReplies", default=None)),
        media_urls=[],
        media_refs=[],
        platform_metadata={
            "platform": "youtube",
            "author_name": _first(item, "authorName", "author", "userName", default=None),
            "author_thumbnail": _first(item, "authorThumbnail", "authorAvatar", "avatarUrl", default=None),
            "published_time_text": published_text,
            "has_creator_heart": item.get("hasCreatorHeart"),
            "author_is_channel_owner": item.get("authorIsChannelOwner"),
            "type": item.get("type"),
            "page_url": item.get("pageUrl"),
        },
        replied_to_id=str(raw_parent) if raw_parent else None,
    )


def parse_apify_youtube_comment_author(item: dict) -> Channel:
    """Channel snapshot for a YouTube comment author."""
    handle = _yt_handle(item)
    channel_id = _first(item, "authorChannelId", "channelId", "authorId", default="")
    channel_url = None
    if handle:
        channel_url = f"https://www.youtube.com/@{handle}"
    elif channel_id:
        channel_url = f"https://www.youtube.com/channel/{channel_id}"
    return Channel(
        channel_id=str(channel_id),
        platform="youtube",
        channel_handle=handle,
        subscribers=None,
        total_posts=None,
        channel_url=channel_url,
        description=None,
        created_date=None,
        channel_metadata={
            "author_name": _first(item, "authorName", "author", "userName", default=None),
            "author_thumbnail": _first(item, "authorThumbnail", "authorAvatar", "avatarUrl", default=None),
        },
    )


def flatten_apify_youtube_comments(items: list[dict], post_id: str) -> list[Comment]:
    """Emit a flat Comment list from the YT comments-scraper dataset.

    The streamers/youtube-comments-scraper actor returns ONE item per
    comment (top-level or reply) in a flat list, with `type` set to
    "comment" or "reply" but no parent-comment linkage on reply items.
    Without that linkage we can't thread replies back to a specific
    parent - so every item is anchored to the post itself (root = self).
    `type` is preserved in `platform_metadata` for downstream filtering.

    The fallback paths for other builds:
      - nested `replies` arrays under a top-level item (legacy shape) -
        children get the top-level's synthesized id as their parent.
      - flat items with a `parentCommentId` set - that linkage is
        preserved as-is.

    Stable synthesized id: many builds don't ship a native `commentId`,
    so we hash (post_id, handle, content, publishedTimeText) and use that
    as `comment_id`. The same source row hashes to the same id on
    re-fetch, so the comments table dedups correctly.
    """
    out: list[Comment] = []
    ref_now = datetime.now(tz=timezone.utc)
    for top in items:
        raw_parent = _first(top, "parentCommentId", "replyToCid", "parentId", default=None)
        is_flat_reply = raw_parent is not None and str(raw_parent) != ""

        top_comment = parse_apify_youtube_comment(
            top,
            parent_comment_id=None if is_flat_reply else post_id,
            ref_now=ref_now,
        )
        if not top_comment.comment_id:
            top_comment.comment_id = _hash_id(
                f"yt|{post_id}|{top_comment.channel_handle}|"
                f"{top_comment.content}|{top.get('publishedTimeText', '')}"
            )
        if not top_comment.comment_id:
            continue
        out.append(top_comment)

        replies = top.get("replies") or []
        if not isinstance(replies, list):
            continue
        for reply in replies:
            if not isinstance(reply, dict):
                continue
            child = parse_apify_youtube_comment(
                reply, parent_comment_id=top_comment.comment_id, ref_now=ref_now,
            )
            if not child.comment_id:
                child.comment_id = _hash_id(
                    f"yt|{post_id}|{top_comment.comment_id}|"
                    f"{child.channel_handle}|{child.content}|"
                    f"{reply.get('publishedTimeText', '')}"
                )
            if child.comment_id:
                out.append(child)
    return out


# ---------------------------------------------------------------------------
# Facebook comments - apify/facebook-comments-scraper
# Dataset item shape (top-level comment on a post):
#   id (or commentId/feedbackId), text (or commentText/message),
#   date (or time/createdTime/timestamp), likesCount, commentsCount,
#   profileName (or name/authorName), profileId (or userId/authorId),
#   profileUrl, commentUrl, replyToCommentId (set on replies),
#   replies[] (nested list of same shape on some builds).
# Anonymous group comments may carry no profileId; we still emit the comment.
# ---------------------------------------------------------------------------

def parse_apify_facebook_comment(item: dict, parent_comment_id: str | None = None) -> Comment:
    """Parse one Facebook comment item into a Comment.

    `parent_comment_id`, when set, overrides any value on the item - used by
    the flattener to stamp the correct parent on nested replies.
    """
    comment_id = str(_first(item, "id", "commentId", "feedbackId", default=""))
    handle = _first(item, "profileName", "name", "authorName", "username", default="")
    owner_id = _first(item, "profileId", "userId", "authorId", default=None)

    commented_at = _parse_dt(
        _first(item, "date", "time", "createdTime", "timestamp", "createdAt")
    )

    replied_to = parent_comment_id or _first(
        item, "replyToCommentId", "parentCommentId", "parentId", default=None,
    )

    return Comment(
        comment_id=comment_id,
        platform="facebook",
        channel_handle=str(handle),
        channel_id=str(owner_id) if owner_id else None,
        content=_first(item, "text", "commentText", "message", "content", default=""),
        commented_at=commented_at or datetime.fromtimestamp(0, tz=timezone.utc),
        likes=_safe_int(_first(item, "likesCount", "likes", "reactionsCount")),
        replies_count=_safe_int(_first(item, "commentsCount", "repliesCount")),
        media_urls=[],
        media_refs=[],
        platform_metadata={
            "platform": "facebook",
            "profile_url": _first(item, "profileUrl", "profilePicUrl", default=None),
            "comment_url": item.get("commentUrl"),
        },
        replied_to_id=str(replied_to) if replied_to else None,
    )


def parse_apify_facebook_comment_author(item: dict) -> Channel:
    """Channel snapshot for a Facebook comment author."""
    handle = _first(item, "profileName", "name", "authorName", "username", default="")
    owner_id = _first(item, "profileId", "userId", "authorId", default="")
    profile_url = _first(item, "profileUrl", default=None)
    return Channel(
        channel_id=str(owner_id),
        platform="facebook",
        channel_handle=str(handle),
        subscribers=None,
        total_posts=None,
        channel_url=profile_url,
        description=None,
        created_date=None,
        channel_metadata={
            "profile_pic_url": item.get("profilePicUrl"),
        },
    )


def flatten_apify_facebook_comments(items: list[dict], post_id: str) -> list[Comment]:
    """Walk top-level items + their nested `replies` and emit a flat Comment
    list with `replied_to_id` populated. Top-level comments anchor to the
    post (root = self); nested replies link to their top-level comment id.
    """
    out: list[Comment] = []
    for top in items:
        top_comment = parse_apify_facebook_comment(top, parent_comment_id=post_id)
        if not top_comment.comment_id:
            continue
        out.append(top_comment)
        replies = top.get("replies") or []
        if not isinstance(replies, list):
            continue
        for reply in replies:
            if not isinstance(reply, dict):
                continue
            child = parse_apify_facebook_comment(
                reply, parent_comment_id=top_comment.comment_id,
            )
            if child.comment_id:
                out.append(child)
    return out


def get_parsers(platform: str, actor_id: str) -> tuple[ParsePostFn, ParseChannelFn]:
    """Look up the (post_parser, channel_parser) pair for the given platform/actor.

    Raises ValueError when no entry exists - call this at adapter init so
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
