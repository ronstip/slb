"""Vetric social data API adapter.

Supports: Instagram, TikTok, Twitter/X, Reddit, YouTube.
"""

import logging
import re
from collections.abc import Iterator
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.vetric_client import VetricAPIError, VetricClient
from workers.collection.adapters.vetric_parsers import (
    flatten_instagram_top_serp,
    parse_instagram_channel,
    parse_instagram_post,
    parse_reddit_channel,
    parse_reddit_post,
    parse_tiktok_channel,
    parse_tiktok_post,
    parse_twitter_channel,
    parse_twitter_post,
    parse_youtube_channel,
    parse_youtube_post,
)
from workers.collection.models import Batch, Channel, Post

logger = logging.getLogger(__name__)


class VetricAdapter(DataProviderAdapter):
    """Wraps Vetric's social data API."""

    _PLATFORM_KEY_ATTRS = [
        ("twitter", "vetric_api_key_twitter"),
        ("instagram", "vetric_api_key_instagram"),
        ("tiktok", "vetric_api_key_tiktok"),
        ("reddit", "vetric_api_key_reddit"),
        ("youtube", "vetric_api_key_youtube"),
    ]

    def __init__(self):
        settings = get_settings()
        self._api_keys: dict[str, str] = {}
        for platform, attr in self._PLATFORM_KEY_ATTRS:
            key = getattr(settings, attr, "")
            if key:
                self._api_keys[platform] = key
        if not self._api_keys:
            raise ValueError("No Vetric API keys configured — set at least one VETRIC_API_KEY_* env var")
        self._client = VetricClient(self._api_keys)
        logger.info("VetricAdapter initialized for platforms: %s", list(self._api_keys.keys()))

    def supported_platforms(self) -> list[str]:
        return list(self._api_keys.keys())

    def collect(self, config: dict) -> Iterator[Batch]:
        platforms = config.get("platforms", [])
        for platform in platforms:
            if platform not in self.supported_platforms():
                continue
            try:
                yield from self._collect_platform(platform, config)
            except VetricAPIError as e:
                logger.error("Vetric API error for %s: %s", platform, e)

    def _collect_platform(self, platform: str, config: dict) -> Iterator[Batch]:
        collector = {
            "instagram": self._collect_instagram,
            "tiktok": self._collect_tiktok,
            "twitter": self._collect_twitter,
            "reddit": self._collect_reddit,
            "youtube": self._collect_youtube,
        }[platform]
        yield from collector(config)

    # ------------------------------------------------------------------
    # Instagram
    # ------------------------------------------------------------------

    def _collect_instagram(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        channel_urls = config.get("channel_urls", [])
        max_posts = config.get("max_posts_per_platform", 200)
        time_range = config.get("time_range", {})
        total = 0

        # Keyword search via top_serp
        for keyword in keywords:
            if total >= max_posts:
                break
            try:
                resp = self._client.get("instagram", "fbsearch/top_serp/", {"query": keyword})
            except VetricAPIError as e:
                logger.warning("Instagram top_serp failed for '%s': %s", keyword, e)
                continue

            items = flatten_instagram_top_serp(resp)
            posts, channels = self._parse_instagram_items(items, time_range, max_posts - total)
            total += len(posts)
            if posts:
                yield Batch(posts=posts, channels=channels)

        # Also search reels
        for keyword in keywords:
            if total >= max_posts:
                break
            try:
                resp = self._client.get("instagram", "search/reels", {"q": keyword})
            except VetricAPIError as e:
                logger.warning("Instagram reels search failed for '%s': %s", keyword, e)
                continue

            items = resp.get("items") or resp.get("medias") or []
            # Reels items may be wrapped: {media: {...}}
            unwrapped = [i.get("media", i) for i in items if isinstance(i, dict)]
            posts, channels = self._parse_instagram_items(unwrapped, time_range, max_posts - total)
            total += len(posts)
            if posts:
                yield Batch(posts=posts, channels=channels)

        # Channel feed collection
        for url in channel_urls:
            if total >= max_posts:
                break
            username = _extract_instagram_username(url)
            if not username:
                continue
            yield from self._collect_instagram_feed(username, config, max_posts - total)

    def _parse_instagram_items(
        self, items: list[dict], time_range: dict, remaining: int
    ) -> tuple[list[Post], list[Channel]]:
        posts: list[Post] = []
        channels_seen: dict[str, Channel] = {}
        for item in items:
            if len(posts) >= remaining:
                break
            post = parse_instagram_post(item)
            if not _in_time_range(post.posted_at, time_range):
                continue
            posts.append(post)
            user = item.get("user") or {}
            handle = user.get("username", "")
            if handle and handle not in channels_seen:
                channels_seen[handle] = parse_instagram_channel(user)
        return posts, list(channels_seen.values())

    def _collect_instagram_feed(
        self, username: str, config: dict, remaining: int
    ) -> Iterator[Batch]:
        time_range = config.get("time_range", {})
        # Resolve username to user_id
        try:
            user_info = self._client.get("instagram", f"users/{username}/usernameinfo")
        except VetricAPIError as e:
            logger.warning("Instagram usernameinfo failed for '%s': %s", username, e)
            return

        user = user_info.get("user") or {}
        user_id = user.get("pk") or user.get("id")
        if not user_id:
            return

        channel = parse_instagram_channel(user)
        collected = 0
        next_max_id = None

        while collected < remaining:
            params: dict = {}
            if next_max_id:
                params["next_max_id"] = next_max_id
            try:
                resp = self._client.get("instagram", f"feed/user/{user_id}", params)
            except VetricAPIError as e:
                logger.warning("Instagram feed failed for user %s: %s", user_id, e)
                break

            items = resp.get("items") or []
            if not items:
                break

            posts: list[Post] = []
            for item in items:
                if collected + len(posts) >= remaining:
                    break
                post = parse_instagram_post(item)
                if not _in_time_range(post.posted_at, time_range):
                    continue
                posts.append(post)

            collected += len(posts)
            if posts:
                yield Batch(posts=posts, channels=[channel] if collected <= len(posts) else [])

            next_max_id = resp.get("next_max_id")
            if not resp.get("more_available", False) or not next_max_id:
                break

    # ------------------------------------------------------------------
    # TikTok
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        max_posts = config.get("max_posts_per_platform", 200)
        time_range = config.get("time_range", {})
        total = 0

        for keyword in keywords:
            if total >= max_posts:
                break
            cursor: str | int | None = None

            while total < max_posts:
                params: dict = {"keyword": keyword}
                if cursor:
                    params["cursor"] = cursor
                try:
                    resp = self._client.get("tiktok", "search/posts-by-keyword", params)
                except VetricAPIError as e:
                    logger.warning("TikTok search failed for '%s': %s", keyword, e)
                    break

                items = resp.get("posts") or resp.get("data") or []
                if not items:
                    break

                posts: list[Post] = []
                channels_seen: dict[str, Channel] = {}
                for item in items:
                    if total + len(posts) >= max_posts:
                        break
                    post = parse_tiktok_post(item)
                    if not _in_time_range(post.posted_at, time_range):
                        continue
                    posts.append(post)
                    author = item.get("author") or {}
                    handle = author.get("username", "")
                    if handle and handle not in channels_seen:
                        channels_seen[handle] = parse_tiktok_channel(author)

                total += len(posts)
                if posts:
                    yield Batch(posts=posts, channels=list(channels_seen.values()))

                pagination = resp.get("pagination") or {}
                if not (pagination.get("hasMore") or pagination.get("has_more")):
                    break
                cursor = pagination.get("cursor")
                if not cursor:
                    break

    # ------------------------------------------------------------------
    # Twitter / X
    # ------------------------------------------------------------------

    def _collect_twitter(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        max_posts = config.get("max_posts_per_platform", 200)
        time_range = config.get("time_range", {})
        total = 0

        for keyword in keywords:
            if total >= max_posts:
                break
            # Search popular first, then recent for more volume
            for search_type in ("popular", "recent"):
                if total >= max_posts:
                    break
                cursor: str | None = None

                while total < max_posts:
                    params: dict = {"query": keyword}
                    if cursor:
                        params["cursor"] = cursor
                    try:
                        resp = self._client.get("twitter", f"search/{search_type}", params)
                    except VetricAPIError as e:
                        logger.warning("Twitter %s search failed for '%s': %s", search_type, keyword, e)
                        break

                    tweets = resp.get("tweets") or []
                    if not tweets:
                        break

                    posts: list[Post] = []
                    channels_seen: dict[str, Channel] = {}
                    for item in tweets:
                        if total + len(posts) >= max_posts:
                            break
                        post = parse_twitter_post(item)
                        if not _in_time_range(post.posted_at, time_range):
                            continue
                        posts.append(post)
                        user_details = (item.get("tweet") or item).get("user_details") or {}
                        handle = user_details.get("screen_name", "")
                        if handle and handle not in channels_seen:
                            channels_seen[handle] = parse_twitter_channel(user_details)

                    total += len(posts)
                    if posts:
                        yield Batch(posts=posts, channels=list(channels_seen.values()))

                    cursor = resp.get("cursor_bottom")
                    if not cursor:
                        break

    # ------------------------------------------------------------------
    # Reddit
    # ------------------------------------------------------------------

    def _collect_reddit(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        max_posts = config.get("max_posts_per_platform", 200)
        time_range = config.get("time_range", {})
        total = 0

        for keyword in keywords:
            if total >= max_posts:
                break
            query = keyword[:256]  # Reddit max query 256 chars
            cursor: str | None = None

            while total < max_posts:
                params: dict = {"query": query, "sort": "RELEVANCE"}
                if cursor:
                    params["cursor"] = cursor
                try:
                    resp = self._client.get("reddit", "discover/posts", params)
                except VetricAPIError as e:
                    logger.warning("Reddit discover failed for '%s': %s", keyword, e)
                    break

                items = resp.get("posts") or resp.get("data") or []
                if not items:
                    break

                posts: list[Post] = []
                channels_seen: dict[str, Channel] = {}
                for item in items:
                    if total + len(posts) >= max_posts:
                        break
                    post = parse_reddit_post(item)
                    if not _in_time_range(post.posted_at, time_range):
                        continue
                    posts.append(post)
                    sub = post.channel_id
                    if sub and sub not in channels_seen:
                        channels_seen[sub] = parse_reddit_channel(item)

                total += len(posts)
                if posts:
                    yield Batch(posts=posts, channels=list(channels_seen.values()))

                page_info = resp.get("pageInfo") or {}
                if not page_info.get("hasNextPage", False):
                    break
                cursor = page_info.get("cursor")
                if not cursor:
                    break

    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------

    def _collect_youtube(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        max_posts = config.get("max_posts_per_platform", 200)
        time_range = config.get("time_range", {})
        total = 0

        for keyword in keywords:
            if total >= max_posts:
                break
            cursor: str | None = None

            while total < max_posts:
                params: dict = {"keywords": keyword, "sortBy": "UploadDate"}
                if cursor:
                    params["cursor"] = cursor
                try:
                    resp = self._client.get("youtube", "discover/videos", params)
                except VetricAPIError as e:
                    logger.warning("YouTube discover failed for '%s': %s", keyword, e)
                    break

                items = resp.get("data") or []
                if not items:
                    break

                posts: list[Post] = []
                channels_seen: dict[str, Channel] = {}
                for item in items:
                    if total + len(posts) >= max_posts:
                        break
                    post = parse_youtube_post(item)
                    if not _in_time_range(post.posted_at, time_range):
                        continue
                    posts.append(post)
                    ch = item.get("channel") or {}
                    ch_name = ch.get("name", "")
                    if ch_name and ch_name not in channels_seen:
                        channels_seen[ch_name] = parse_youtube_channel(ch)

                total += len(posts)
                if posts:
                    yield Batch(posts=posts, channels=list(channels_seen.values()))

                cursor = resp.get("cursor")
                if not cursor:
                    break

    # ------------------------------------------------------------------
    # Engagement refresh
    # ------------------------------------------------------------------

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        results = []
        for url in post_urls:
            platform = _detect_platform_from_url(url)
            if not platform:
                logger.warning("Cannot determine platform for URL: %s", url)
                continue
            try:
                engagement = self._fetch_single_engagement(platform, url)
                if engagement:
                    engagement["post_url"] = url
                    results.append(engagement)
            except VetricAPIError as e:
                logger.warning("Failed to fetch engagement for %s: %s", url, e)
        return results

    def _fetch_single_engagement(self, platform: str, url: str) -> dict | None:
        if platform == "twitter":
            tweet_id = _extract_twitter_id(url)
            if not tweet_id:
                return None
            resp = self._client.get("twitter", f"tweet/{tweet_id}/details")
            tweet = resp.get("tweet") or {}
            view_count = tweet.get("view_count")
            if isinstance(view_count, str):
                try:
                    view_count = int(view_count)
                except ValueError:
                    view_count = None
            return {
                "likes": tweet.get("favorite_count"),
                "shares": tweet.get("retweet_count"),
                "comments_count": tweet.get("reply_count"),
                "views": view_count,
                "saves": tweet.get("bookmark_count"),
                "comments": [],
            }

        if platform == "youtube":
            video_id = _extract_youtube_id(url)
            if not video_id:
                return None
            resp = self._client.get("youtube", f"video/{video_id}/about")
            return {
                "likes": resp.get("likeCount"),
                "shares": None,
                "comments_count": resp.get("commentCount"),
                "views": resp.get("viewCount"),
                "saves": None,
                "comments": [],
            }

        # Instagram, Reddit, TikTok: limited or no engagement refresh support
        return None


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def _in_time_range(posted_at: datetime, time_range: dict) -> bool:
    if not time_range:
        return True
    start_str = time_range.get("start")
    end_str = time_range.get("end")
    if start_str:
        start = datetime.fromisoformat(start_str).replace(tzinfo=timezone.utc)
        if posted_at < start:
            return False
    if end_str:
        end = datetime.fromisoformat(end_str).replace(tzinfo=timezone.utc)
        if posted_at > end:
            return False
    return True


def _extract_instagram_username(url: str) -> str | None:
    match = re.search(r"instagram\.com/([^/?#]+)", url)
    return match.group(1) if match else None


def _extract_twitter_id(url: str) -> str | None:
    match = re.search(r"(?:twitter|x)\.com/.+/status/(\d+)", url)
    return match.group(1) if match else None


def _extract_youtube_id(url: str) -> str | None:
    match = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([^&?#]+)", url)
    return match.group(1) if match else None


def _detect_platform_from_url(url: str) -> str | None:
    domain_map = {
        "instagram.com": "instagram",
        "tiktok.com": "tiktok",
        "twitter.com": "twitter",
        "x.com": "twitter",
        "reddit.com": "reddit",
        "youtube.com": "youtube",
        "youtu.be": "youtube",
    }
    for domain, platform in domain_map.items():
        if domain in url:
            return platform
    return None
