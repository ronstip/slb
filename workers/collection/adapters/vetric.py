"""Vetric social data API adapter.

Supports: Instagram, TikTok, Twitter/X, Reddit, YouTube.

Platforms and keywords are collected in parallel via ThreadPoolExecutor for
speed and fault isolation — a single failed API call does not block others.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

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

_MAX_WORKERS_PLATFORMS = 5
_MAX_WORKERS_KEYWORDS = 5


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

    def collect(self, config: dict) -> list[Batch]:
        platforms = [p for p in config.get("platforms", []) if p in self.supported_platforms()]
        if not platforms:
            return []

        collector_map = {
            "instagram": self._collect_instagram,
            "tiktok": self._collect_tiktok,
            "twitter": self._collect_twitter,
            "reddit": self._collect_reddit,
            "youtube": self._collect_youtube,
        }

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(platforms), _MAX_WORKERS_PLATFORMS)) as pool:
            futures = {
                pool.submit(collector_map[p], config): p
                for p in platforms
            }
            for future in as_completed(futures):
                platform = futures[future]
                try:
                    batches = future.result()
                    all_batches.extend(batches)
                    logger.info("Platform %s: collected %d batches", platform, len(batches))
                except (VetricAPIError, requests.RequestException) as e:
                    logger.error("Vetric API error for %s: %s", platform, e)
                except Exception:
                    logger.exception("Unexpected error collecting %s", platform)

        return all_batches

    # ------------------------------------------------------------------
    # Instagram
    # ------------------------------------------------------------------

    def _collect_instagram(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        channel_urls = config.get("channel_urls", [])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})

        # Build task list: (task_type, target)
        tasks: list[tuple[str, str]] = []
        for kw in keywords:
            tasks.append(("top_serp", kw))
            tasks.append(("reels", kw))
        for url in channel_urls:
            username = _extract_instagram_username(url)
            if username:
                tasks.append(("feed", username))

        if not tasks:
            return []

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(tasks), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(self._ig_task, task_type, target, time_range, max_calls): (task_type, target)
                for task_type, target in tasks
            }
            for future in as_completed(futures):
                task_type, target = futures[future]
                try:
                    all_batches.extend(future.result())
                except (VetricAPIError, requests.RequestException) as e:
                    logger.warning("Instagram %s failed for '%s': %s", task_type, target, e)
                except Exception:
                    logger.exception("Instagram %s unexpected error for '%s'", task_type, target)

        return all_batches

    def _ig_task(self, task_type: str, target: str, time_range: dict, max_calls: int) -> list[Batch]:
        if task_type == "top_serp":
            return self._ig_top_serp(target, time_range)
        elif task_type == "reels":
            return self._ig_reels(target, time_range)
        else:  # feed
            return self._ig_feed(target, time_range, max_calls)

    def _ig_top_serp(self, keyword: str, time_range: dict) -> list[Batch]:
        resp = self._client.get("instagram", "fbsearch/top_serp/", {"query": keyword})
        items = flatten_instagram_top_serp(resp)
        posts, channels = self._parse_instagram_items(items, time_range)
        return [Batch(posts=posts, channels=channels)] if posts else []

    def _ig_reels(self, keyword: str, time_range: dict) -> list[Batch]:
        resp = self._client.get("instagram", "search/reels", {"q": keyword})
        items = resp.get("items") or resp.get("medias") or []
        unwrapped = [i.get("media", i) for i in items if isinstance(i, dict)]
        posts, channels = self._parse_instagram_items(unwrapped, time_range)
        return [Batch(posts=posts, channels=channels)] if posts else []

    def _ig_feed(self, username: str, time_range: dict, max_calls: int) -> list[Batch]:
        user_info = self._client.get("instagram", f"users/{username}/usernameinfo")
        user = user_info.get("user") or {}
        user_id = user.get("pk") or user.get("id")
        if not user_id:
            return []

        channel = parse_instagram_channel(user)
        batches: list[Batch] = []
        next_max_id = None

        for _ in range(max_calls):
            params: dict = {}
            if next_max_id:
                params["next_max_id"] = next_max_id
            resp = self._client.get("instagram", f"feed/user/{user_id}", params)

            items = resp.get("items") or []
            if not items:
                break

            posts: list[Post] = []
            for item in items:
                post = parse_instagram_post(item)
                if _in_time_range(post.posted_at, time_range):
                    posts.append(post)

            if posts:
                batches.append(Batch(posts=posts, channels=[channel] if not batches else []))

            next_max_id = resp.get("next_max_id")
            if not resp.get("more_available", False) or not next_max_id:
                break

        return batches

    def _parse_instagram_items(
        self, items: list[dict], time_range: dict
    ) -> tuple[list[Post], list[Channel]]:
        posts: list[Post] = []
        channels_seen: dict[str, Channel] = {}
        for item in items:
            post = parse_instagram_post(item)
            if not _in_time_range(post.posted_at, time_range):
                continue
            posts.append(post)
            user = item.get("user") or {}
            handle = user.get("username", "")
            if handle and handle not in channels_seen:
                channels_seen[handle] = parse_instagram_channel(user)
        return posts, list(channels_seen.values())

    # ------------------------------------------------------------------
    # TikTok
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})

        if not keywords:
            return []

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(self._tiktok_search, kw, time_range, max_calls): kw
                for kw in keywords
            }
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    all_batches.extend(future.result())
                except (VetricAPIError, requests.RequestException) as e:
                    logger.warning("TikTok search failed for '%s': %s", kw, e)
                except Exception:
                    logger.exception("TikTok unexpected error for '%s'", kw)

        return all_batches

    def _tiktok_search(self, keyword: str, time_range: dict, max_calls: int) -> list[Batch]:
        batches: list[Batch] = []
        cursor: str | int | None = None

        for _ in range(max_calls):
            params: dict = {"keyword": keyword}
            if cursor:
                params["cursor"] = cursor
            resp = self._client.get("tiktok", "search/posts-by-keyword", params)

            items = resp.get("posts") or resp.get("data") or []
            if not items:
                break

            posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for item in items:
                post = parse_tiktok_post(item)
                if not _in_time_range(post.posted_at, time_range):
                    continue
                posts.append(post)
                author = item.get("author") or {}
                handle = author.get("username", "")
                if handle and handle not in channels_seen:
                    channels_seen[handle] = parse_tiktok_channel(author)

            if posts:
                batches.append(Batch(posts=posts, channels=list(channels_seen.values())))

            pagination = resp.get("pagination") or {}
            if not (pagination.get("hasMore") or pagination.get("has_more")):
                break
            cursor = pagination.get("cursor")
            if not cursor:
                break

        return batches

    # ------------------------------------------------------------------
    # Twitter / X
    # ------------------------------------------------------------------

    def _collect_twitter(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})

        if not keywords:
            return []

        # Build tasks: each keyword × search type
        tasks: list[tuple[str, str]] = []
        for kw in keywords:
            tasks.append(("popular", kw))
            tasks.append(("recent", kw))

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(tasks), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(self._twitter_search, search_type, kw, time_range, max_calls): (search_type, kw)
                for search_type, kw in tasks
            }
            for future in as_completed(futures):
                search_type, kw = futures[future]
                try:
                    all_batches.extend(future.result())
                except (VetricAPIError, requests.RequestException) as e:
                    logger.warning("Twitter %s search failed for '%s': %s", search_type, kw, e)
                except Exception:
                    logger.exception("Twitter %s unexpected error for '%s'", search_type, kw)

        return all_batches

    def _twitter_search(self, search_type: str, keyword: str, time_range: dict, max_calls: int) -> list[Batch]:
        batches: list[Batch] = []
        cursor: str | None = None

        for _ in range(max_calls):
            params: dict = {"query": keyword}
            if cursor:
                params["cursor"] = cursor
            resp = self._client.get("twitter", f"search/{search_type}", params)

            tweets = resp.get("tweets") or []
            if not tweets:
                break

            posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for item in tweets:
                post = parse_twitter_post(item)
                if not _in_time_range(post.posted_at, time_range):
                    continue
                posts.append(post)
                user_details = (item.get("tweet") or item).get("user_details") or {}
                handle = user_details.get("screen_name", "")
                if handle and handle not in channels_seen:
                    channels_seen[handle] = parse_twitter_channel(user_details)

            if posts:
                batches.append(Batch(posts=posts, channels=list(channels_seen.values())))

            cursor = resp.get("cursor_bottom")
            if not cursor:
                break

        return batches

    # ------------------------------------------------------------------
    # Reddit
    # ------------------------------------------------------------------

    def _collect_reddit(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})

        if not keywords:
            return []

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(self._reddit_search, kw, time_range, max_calls): kw
                for kw in keywords
            }
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    all_batches.extend(future.result())
                except (VetricAPIError, requests.RequestException) as e:
                    logger.warning("Reddit discover failed for '%s': %s", kw, e)
                except Exception:
                    logger.exception("Reddit unexpected error for '%s'", kw)

        return all_batches

    def _reddit_search(self, keyword: str, time_range: dict, max_calls: int) -> list[Batch]:
        batches: list[Batch] = []
        query = keyword[:256]  # Reddit max query 256 chars
        cursor: str | None = None

        for _ in range(max_calls):
            params: dict = {"query": query, "sort": "RELEVANCE"}
            if cursor:
                params["cursor"] = cursor
            resp = self._client.get("reddit", "discover/posts", params)

            items = resp.get("posts") or resp.get("data") or []
            if not items:
                break

            posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for item in items:
                post = parse_reddit_post(item)
                if not _in_time_range(post.posted_at, time_range):
                    continue
                posts.append(post)
                sub = post.channel_id
                if sub and sub not in channels_seen:
                    channels_seen[sub] = parse_reddit_channel(item)

            if posts:
                batches.append(Batch(posts=posts, channels=list(channels_seen.values())))

            page_info = resp.get("pageInfo") or {}
            if not page_info.get("hasNextPage", False):
                break
            cursor = page_info.get("cursor")
            if not cursor:
                break

        return batches

    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------

    def _collect_youtube(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})

        if not keywords:
            return []

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(self._youtube_search, kw, time_range, max_calls): kw
                for kw in keywords
            }
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    all_batches.extend(future.result())
                except (VetricAPIError, requests.RequestException) as e:
                    logger.warning("YouTube discover failed for '%s': %s", kw, e)
                except Exception:
                    logger.exception("YouTube unexpected error for '%s'", kw)

        return all_batches

    def _youtube_search(self, keyword: str, time_range: dict, max_calls: int) -> list[Batch]:
        batches: list[Batch] = []
        cursor: str | None = None

        for _ in range(max_calls):
            params: dict = {"keywords": keyword, "sortBy": "UploadDate"}
            if cursor:
                params["cursor"] = cursor
            resp = self._client.get("youtube", "discover/videos", params)

            items = resp.get("data") or []
            if not items:
                break

            posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for item in items:
                post = parse_youtube_post(item)
                if not _in_time_range(post.posted_at, time_range):
                    continue
                posts.append(post)
                ch = item.get("channel") or {}
                ch_name = ch.get("name", "")
                if ch_name and ch_name not in channels_seen:
                    channels_seen[ch_name] = parse_youtube_channel(ch)

            if posts:
                batches.append(Batch(posts=posts, channels=list(channels_seen.values())))

            cursor = resp.get("cursor")
            if not cursor:
                break

        return batches

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
            except (VetricAPIError, requests.RequestException) as e:
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
