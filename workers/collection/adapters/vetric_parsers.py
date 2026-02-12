"""Transform Vetric API responses into Post/Channel model instances.

Each platform has its own parse function because Vetric returns
different schemas per platform. All parsers use defensive .get()
with defaults so missing fields produce valid objects, never crashes.
"""

from datetime import datetime, timezone

from workers.collection.models import Channel, Post


# ---------------------------------------------------------------------------
# Instagram
# ---------------------------------------------------------------------------

def parse_instagram_post(item: dict) -> Post:
    """Parse a single Instagram media item from Vetric.

    Works for both feed/user/{id} items and media items extracted
    from fbsearch/top_serp via flatten_instagram_top_serp().
    """
    user = item.get("user") or {}
    caption = item.get("caption") or {}
    media_type_code = item.get("media_type", 1)
    post_type_map = {1: "image", 2: "video", 8: "carousel"}
    code = item.get("code", "")

    return Post(
        post_id=str(item.get("pk", item.get("id", ""))),
        platform="instagram",
        channel_handle=user.get("username", ""),
        channel_id=str(user.get("pk", user.get("id", ""))),
        title=None,
        content=caption.get("text", ""),
        post_url=f"https://www.instagram.com/p/{code}/" if code else "",
        posted_at=datetime.fromtimestamp(item.get("taken_at", 0), tz=timezone.utc),
        post_type=post_type_map.get(media_type_code, "image"),
        parent_post_id=None,
        media_urls=_extract_instagram_media(item),
        media_refs=[],
        likes=item.get("like_count"),
        shares=None,
        comments_count=item.get("comment_count"),
        views=item.get("play_count"),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "instagram",
            "media_type_code": media_type_code,
            "video_duration": item.get("video_duration"),
            "author": user.get("username"),
        },
    )


def parse_instagram_channel(user: dict) -> Channel:
    """Parse an Instagram user profile into a Channel."""
    username = user.get("username", "")
    return Channel(
        channel_id=str(user.get("pk", user.get("id", ""))),
        platform="instagram",
        channel_handle=username,
        subscribers=user.get("follower_count"),
        total_posts=user.get("media_count"),
        channel_url=f"https://www.instagram.com/{username}/" if username else "",
        description=user.get("biography"),
        created_date=None,
        channel_metadata={
            "verified": user.get("is_verified", False),
            "full_name": user.get("full_name"),
            "category": user.get("category"),
        },
    )


def flatten_instagram_top_serp(resp: dict) -> list[dict]:
    """Extract media items from Instagram's nested top_serp response.

    The response has: media_grid.sections[].layout_content.{key}.clips.items[].media
    This flattens all of those into a simple list of media dicts.
    """
    items = []
    media_grid = resp.get("media_grid") or {}
    sections = media_grid.get("sections") or []
    for section in sections:
        layout_content = section.get("layout_content") or {}
        for layout_key, layout_val in layout_content.items():
            if isinstance(layout_val, dict):
                # Could be clips, medias, or other layout types
                clips = layout_val.get("clips") or {}
                clip_items = clips.get("items") or []
                for clip_item in clip_items:
                    media = clip_item.get("media")
                    if media:
                        items.append(media)
                # Also handle direct media items (non-clips layouts)
                medias = layout_val.get("medias") or []
                for media_item in medias:
                    media = media_item.get("media", media_item)
                    if media and isinstance(media, dict):
                        items.append(media)
    return items


def _extract_instagram_media(item: dict) -> list[str]:
    """Extract best-quality image/video URLs from an Instagram media item."""
    urls: list[str] = []
    # Carousel items
    carousel = item.get("carousel_media") or []
    if carousel:
        for cm in carousel:
            url = _best_instagram_image(cm)
            if url:
                urls.append(url)
            if cm.get("video_versions"):
                urls.append(cm["video_versions"][0]["url"])
        return urls
    # Single image
    url = _best_instagram_image(item)
    if url:
        urls.append(url)
    # Single video
    if item.get("video_versions"):
        urls.append(item["video_versions"][0]["url"])
    return urls


def _best_instagram_image(item: dict) -> str | None:
    candidates = (item.get("image_versions2") or {}).get("candidates") or []
    if candidates:
        return candidates[0].get("url")
    return None


# ---------------------------------------------------------------------------
# TikTok
# ---------------------------------------------------------------------------

def parse_tiktok_post(item: dict) -> Post:
    """Parse a TikTok post from search/posts-by-keyword response."""
    author = item.get("author") or {}
    stats = item.get("statistics") or {}
    video = item.get("video") or {}
    mentions = item.get("mentions") or {}

    media_urls: list[str] = []
    cover = video.get("cover") or {}
    cover_urls = cover.get("url_list") or []
    if cover_urls:
        media_urls.append(cover_urls[0])
    play_addr = video.get("play_addr") or {}
    play_urls = play_addr.get("url_list") or []
    if play_urls:
        media_urls.append(play_urls[0])

    username = author.get("username", "")
    post_id = str(item.get("post_id", ""))

    return Post(
        post_id=post_id,
        platform="tiktok",
        channel_handle=username,
        channel_id=author.get("sec_uid", ""),
        title=None,
        content=item.get("desc", ""),
        post_url=item.get("post_url") or f"https://www.tiktok.com/@{username}/video/{post_id}",
        posted_at=datetime.fromtimestamp(item.get("create_time", 0), tz=timezone.utc),
        post_type="video",
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=stats.get("likes_count"),
        shares=stats.get("share_count"),
        comments_count=stats.get("comment_count"),
        views=stats.get("play_count"),
        saves=stats.get("collect_count"),
        comments=[],
        platform_metadata={
            "platform": "tiktok",
            "author": username,
            "follower_count": author.get("follower_count"),
            "hashtags": mentions.get("hashtags", []),
            "music": item.get("music"),
            "region": item.get("region"),
            "desc_language": item.get("desc_language"),
        },
    )


def parse_tiktok_channel(author: dict) -> Channel:
    """Parse a TikTok author from search results into a Channel."""
    username = author.get("username", "")
    return Channel(
        channel_id=author.get("sec_uid", ""),
        platform="tiktok",
        channel_handle=username,
        subscribers=author.get("follower_count"),
        total_posts=author.get("video_count"),
        channel_url=f"https://www.tiktok.com/@{username}" if username else "",
        description=None,
        created_date=None,
        channel_metadata={
            "verification_type": author.get("verification_type"),
            "nickname": author.get("nickname"),
            "custom_verify": author.get("custom_verify"),
        },
    )


# ---------------------------------------------------------------------------
# Twitter / X
# ---------------------------------------------------------------------------

def parse_twitter_post(item: dict) -> Post:
    """Parse a tweet from Vetric's search/popular or search/recent response.

    Response structure: {"entryId": "...", "tweet": {...}}
    """
    tweet = item.get("tweet", item)
    user_details = tweet.get("user_details") or {}

    # Parse parent_post_id for retweets and quote tweets
    parent_post_id = None
    quoted_tweet_data = None
    if tweet.get("is_retweet"):
        rt = tweet.get("retweeted_status_result", {}).get("result") or {}
        parent_post_id = str(rt.get("rest_id", "")) or None
    if tweet.get("is_quote_status"):
        qt = (tweet.get("quoted_status_result") or {}).get("result") or {}
        qt_id = str(qt.get("rest_id", ""))
        if qt_id:
            parent_post_id = parent_post_id or qt_id
            qt_user = qt.get("user_details") or {}
            quoted_tweet_data = {
                "rest_id": qt_id,
                "full_text": qt.get("full_text"),
                "screen_name": qt_user.get("screen_name"),
            }

    view_count = tweet.get("view_count")
    if isinstance(view_count, str):
        try:
            view_count = int(view_count)
        except ValueError:
            view_count = None

    return Post(
        post_id=str(tweet.get("rest_id", "")),
        platform="twitter",
        channel_handle=user_details.get("screen_name", ""),
        channel_id=str(user_details.get("rest_id", user_details.get("id_str", ""))),
        title=None,
        content=tweet.get("full_text", ""),
        post_url=tweet.get("url", ""),
        posted_at=_parse_twitter_date(tweet.get("created_at", "")),
        post_type=_infer_tweet_type(tweet),
        parent_post_id=parent_post_id,
        media_urls=_extract_twitter_media(tweet),
        media_refs=[],
        likes=tweet.get("favorite_count"),
        shares=tweet.get("retweet_count"),
        comments_count=tweet.get("reply_count"),
        views=view_count,
        saves=tweet.get("bookmark_count"),
        comments=[],
        platform_metadata={
            "platform": "twitter",
            "author": user_details.get("screen_name"),
            "followers_count": user_details.get("followers_count"),
            "verified_type": user_details.get("verified_type"),
            "is_blue_verified": user_details.get("is_blue_verified"),
            "lang": tweet.get("lang"),
            "conversation_id": tweet.get("conversation_id_str"),
            "is_quote_status": tweet.get("is_quote_status"),
            "is_retweet": tweet.get("is_retweet"),
            "quoted_tweet": quoted_tweet_data,
        },
    )


def parse_twitter_channel(user_details: dict) -> Channel:
    """Parse Twitter user_details into a Channel."""
    screen_name = user_details.get("screen_name", "")
    return Channel(
        channel_id=str(user_details.get("rest_id", user_details.get("id_str", ""))),
        platform="twitter",
        channel_handle=screen_name,
        subscribers=user_details.get("followers_count"),
        total_posts=user_details.get("statuses_count"),
        channel_url=f"https://x.com/{screen_name}" if screen_name else "",
        description=user_details.get("description"),
        created_date=_parse_twitter_date(user_details.get("created_at", "")),
        channel_metadata={
            "verified": user_details.get("verified"),
            "verified_type": user_details.get("verified_type"),
            "is_blue_verified": user_details.get("is_blue_verified"),
            "name": user_details.get("name"),
            "media_count": user_details.get("media_count"),
            "friends_count": user_details.get("friends_count"),
        },
    )


def _parse_twitter_date(date_str: str) -> datetime:
    """Parse Twitter's date format: 'Wed May 21 10:11:40 +0000 2025'."""
    if not date_str:
        return datetime.now(timezone.utc)
    try:
        return datetime.strptime(date_str, "%a %b %d %H:%M:%S %z %Y")
    except ValueError:
        return datetime.now(timezone.utc)


def _infer_tweet_type(tweet: dict) -> str:
    media = (tweet.get("extended_entities") or {}).get("media") or []
    for m in media:
        if m.get("type") == "video" or m.get("type") == "animated_gif":
            return "video"
        if m.get("type") == "photo":
            return "image"
    return "text"


def _extract_twitter_media(tweet: dict) -> list[str]:
    """Extract media URLs from a tweet's extended_entities."""
    urls: list[str] = []
    media = (tweet.get("extended_entities") or {}).get("media") or []
    for m in media:
        if m.get("type") == "video" or m.get("type") == "animated_gif":
            variants = (m.get("video_info") or {}).get("variants") or []
            # Pick highest quality mp4 variant
            mp4s = [v for v in variants if v.get("content_type") == "video/mp4"]
            if mp4s:
                urls.append(mp4s[-1]["url"])
            elif variants:
                urls.append(variants[0]["url"])
        elif m.get("media_url_https"):
            urls.append(m["media_url_https"])
    return urls


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------

def parse_reddit_post(item: dict) -> Post:
    """Parse a Reddit post from Vetric's discover/posts response.

    Note: Exact field names are best-guess from standard Reddit patterns.
    Will be confirmed during implementation with live API calls.
    """
    author = item.get("author")
    if isinstance(author, dict):
        author_name = author.get("name", "")
    else:
        author_name = str(author) if author else ""

    subreddit = item.get("subreddit")
    if isinstance(subreddit, dict):
        subreddit_name = subreddit.get("name", "")
    else:
        subreddit_name = str(subreddit) if subreddit else ""

    # Build post URL
    permalink = item.get("permalink", "")
    post_url = item.get("url", "")
    if permalink and not permalink.startswith("http"):
        post_url = f"https://www.reddit.com{permalink}"
    elif permalink:
        post_url = permalink

    # Posted time
    created = item.get("created_utc", item.get("created", 0))
    if isinstance(created, (int, float)) and created > 0:
        posted_at = datetime.fromtimestamp(created, tz=timezone.utc)
    else:
        posted_at = datetime.now(timezone.utc)

    return Post(
        post_id=str(item.get("id", "")),
        platform="reddit",
        channel_handle=author_name,
        channel_id=subreddit_name,
        title=item.get("title"),
        content=item.get("selftext", item.get("body", "")),
        post_url=post_url,
        posted_at=posted_at,
        post_type=_infer_reddit_post_type(item),
        parent_post_id=None,
        media_urls=_extract_reddit_media(item),
        media_refs=[],
        likes=item.get("score", item.get("ups")),
        shares=None,
        comments_count=item.get("num_comments"),
        views=None,
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "reddit",
            "subreddit": subreddit_name,
            "author": author_name,
            "upvote_ratio": item.get("upvote_ratio"),
            "flair": item.get("link_flair_text"),
        },
    )


def parse_reddit_channel(item: dict) -> Channel:
    """Parse minimal channel info from a Reddit post's subreddit field."""
    subreddit = item.get("subreddit")
    if isinstance(subreddit, dict):
        subreddit_name = subreddit.get("name", "")
    else:
        subreddit_name = str(subreddit) if subreddit else ""

    return Channel(
        channel_id=subreddit_name,
        platform="reddit",
        channel_handle=subreddit_name,
        subscribers=None,
        total_posts=None,
        channel_url=f"https://www.reddit.com/r/{subreddit_name}" if subreddit_name else "",
        description=None,
        created_date=None,
        channel_metadata={},
    )


def _infer_reddit_post_type(item: dict) -> str:
    if item.get("is_video"):
        return "video"
    hint = item.get("post_hint", "")
    if hint == "image":
        return "image"
    thumbnail = item.get("thumbnail", "")
    if isinstance(thumbnail, str) and thumbnail.startswith("http"):
        return "image"
    if item.get("is_self", True):
        return "text"
    return "link"


def _extract_reddit_media(item: dict) -> list[str]:
    urls: list[str] = []
    thumbnail = item.get("thumbnail", "")
    if isinstance(thumbnail, str) and thumbnail.startswith("http"):
        urls.append(thumbnail)
    return urls


# ---------------------------------------------------------------------------
# YouTube
# ---------------------------------------------------------------------------

def parse_youtube_post(item: dict) -> Post:
    """Parse a YouTube video from Vetric's discover/videos response."""
    channel = item.get("channel") or {}
    video_id = str(item.get("id", ""))

    # publishedAt can be ISO string
    published = item.get("publishedAt", "")
    posted_at = _parse_iso_date(published)

    media_urls: list[str] = []
    thumb = item.get("thumbnailUrl")
    if thumb:
        media_urls.append(thumb)
    elif video_id:
        media_urls.append(f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg")

    return Post(
        post_id=video_id,
        platform="youtube",
        channel_handle=channel.get("name", ""),
        channel_id=str(channel.get("id", "")),
        title=item.get("title"),
        content=item.get("description"),
        post_url=item.get("url") or (f"https://www.youtube.com/watch?v={video_id}" if video_id else ""),
        posted_at=posted_at,
        post_type="video",
        parent_post_id=None,
        media_urls=media_urls,
        media_refs=[],
        likes=item.get("likeCount"),
        shares=None,
        comments_count=item.get("commentCount"),
        views=item.get("viewCount"),
        saves=None,
        comments=[],
        platform_metadata={
            "platform": "youtube",
            "channel_name": channel.get("name"),
            "channel_id": channel.get("id"),
            "duration": item.get("duration"),
            "channel_url": channel.get("url"),
        },
    )


def parse_youtube_channel(channel: dict) -> Channel:
    """Parse a YouTube channel from search result's channel field."""
    ch_id = str(channel.get("id", ""))
    name = channel.get("name", "")
    return Channel(
        channel_id=ch_id,
        platform="youtube",
        channel_handle=name,
        subscribers=channel.get("subscriberCount"),
        total_posts=None,
        channel_url=channel.get("url") or (f"https://www.youtube.com/channel/{ch_id}" if ch_id else ""),
        description=None,
        created_date=None,
        channel_metadata={},
    )


def _parse_iso_date(date_val: str | int | float | None) -> datetime:
    """Parse an ISO date string or unix timestamp into a UTC datetime."""
    if isinstance(date_val, (int, float)) and date_val > 0:
        return datetime.fromtimestamp(date_val, tz=timezone.utc)
    if isinstance(date_val, str) and date_val:
        try:
            return datetime.fromisoformat(date_val.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)
