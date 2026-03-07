"""Bright Data dataset scraping API adapter.

Supports: TikTok, YouTube, Reddit.

Uses Bright Data's async trigger → poll → download lifecycle.
All keywords for a platform are batched into a single API call.
Platforms are collected in parallel via ThreadPoolExecutor.
"""

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.brightdata_client import BrightDataAPIError, BrightDataClient
from workers.collection.adapters.brightdata_parsers import (
    parse_brightdata_reddit_channel,
    parse_brightdata_reddit_post,
    parse_brightdata_tiktok_channel,
    parse_brightdata_tiktok_post,
    parse_brightdata_youtube_channel,
    parse_brightdata_youtube_post,
)
from workers.collection.models import Batch, Channel, Post

logger = logging.getLogger(__name__)

_MAX_WORKERS_PLATFORMS = 3


class BrightDataAdapter(DataProviderAdapter):
    """Bright Data dataset scraping API adapter for TikTok, YouTube, Reddit."""

    _DATASET_IDS = {
        "tiktok": {"posts": "gd_lu702nij2f790tmv9h", "profiles": "gd_l1villgoiiidt09ci", "comments": "gd_lkf2st302ap89utw5k"},
        "youtube": {"posts": "gd_lk56epmy2i5g7lzu0k", "profiles": "gd_lk538t2k2p1k3oos71"},
        "reddit": {"posts": "gd_lvz8ah06191smkebj4", "comments": "gd_lvzdpsdlw09j6t702"},
    }

    _PLATFORM_PARSERS = {
        "tiktok": (parse_brightdata_tiktok_post, parse_brightdata_tiktok_channel),
        "youtube": (parse_brightdata_youtube_post, parse_brightdata_youtube_channel),
        "reddit": (parse_brightdata_reddit_post, parse_brightdata_reddit_channel),
    }

    def __init__(self):
        settings = get_settings()
        if not settings.brightdata_api_token:
            raise ValueError("BRIGHTDATA_API_TOKEN not configured")
        self._client = BrightDataClient(
            api_token=settings.brightdata_api_token,
            poll_max_wait_sec=settings.brightdata_poll_max_wait_sec,
            poll_initial_interval_sec=settings.brightdata_poll_initial_interval_sec,
        )
        self._platform_stats: dict[str, dict] = {}
        self._stats_lock = threading.Lock()
        logger.info("BrightDataAdapter initialized")

    def supported_platforms(self) -> list[str]:
        return ["tiktok", "youtube", "reddit"]

    @property
    def platform_stats(self) -> dict[str, dict]:
        return dict(self._platform_stats)

    def collect(self, config: dict) -> list[Batch]:
        """Collect from all assigned platforms in parallel."""
        self._platform_stats = {}
        platforms = [p for p in config.get("platforms", []) if p in self.supported_platforms()]
        if not platforms:
            return []

        collector_map = {
            "tiktok": self._collect_tiktok,
            "youtube": self._collect_youtube,
            "reddit": self._collect_reddit,
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
                    post_count = sum(len(b.posts) for b in batches)
                    with self._stats_lock:
                        self._platform_stats[platform] = {
                            "posts": post_count,
                            "batches": len(batches),
                            "errors": 0,
                        }
                    logger.info("BrightData %s: collected %d posts", platform, post_count)
                except BrightDataAPIError as e:
                    with self._stats_lock:
                        self._platform_stats[platform] = {"posts": 0, "batches": 0, "errors": 1, "error": str(e)}
                    logger.error("BrightData API error for %s: %s", platform, e)
                except Exception:
                    with self._stats_lock:
                        self._platform_stats[platform] = {"posts": 0, "batches": 0, "errors": 1}
                    logger.exception("Unexpected error collecting %s via BrightData", platform)

        return all_batches

    # ------------------------------------------------------------------
    # TikTok
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        if not keywords:
            return []

        num_per_kw = config.get("max_posts_per_keyword") or config.get("max_calls", 2) * 10
        geo = config.get("geo_scope", "")
        if geo == "global":
            geo = ""

        inputs = [
            {"search_keyword": kw, "num_of_posts": num_per_kw, "country": geo}
            for kw in keywords
        ]

        results = self._client.scrape_and_wait(
            dataset_id=self._DATASET_IDS["tiktok"]["posts"],
            inputs=inputs,
            discover_by="keyword",
        )
        # Filter out error objects (e.g., {"error": "Rate limited", "error_code": "dead_page"})
        valid = [r for r in results if not r.get("error")]
        if len(valid) < len(results):
            logger.warning(
                "BrightData TikTok: filtered %d error results out of %d",
                len(results) - len(valid), len(results),
            )
        return self._parse_results("tiktok", valid)

    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------

    def _collect_youtube(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        if not keywords:
            return []

        num_per_kw = config.get("max_posts_per_keyword") or config.get("max_calls", 2) * 10
        time_range = config.get("time_range", {})
        start = _to_bd_date_mmddyyyy(time_range.get("start"))
        end = _to_bd_date_mmddyyyy(time_range.get("end"))

        inputs = [
            {
                "keyword": kw,
                "num_of_posts": str(num_per_kw),  # YouTube requires string
                "start_date": start,
                "end_date": end,
                "country": "",
            }
            for kw in keywords
        ]

        results = self._client.scrape_and_wait(
            dataset_id=self._DATASET_IDS["youtube"]["posts"],
            inputs=inputs,
            discover_by="keyword",
        )
        # Filter out error objects (e.g., {"error": "Wrong posted date.", "error_code": "dead_page"})
        valid = [r for r in results if not r.get("error")]
        if len(valid) < len(results):
            logger.warning(
                "BrightData YouTube: filtered %d error results out of %d",
                len(results) - len(valid), len(results),
            )
        return self._parse_results("youtube", valid)

    # ------------------------------------------------------------------
    # Reddit
    # ------------------------------------------------------------------

    def _collect_reddit(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", [])
        subreddit_urls = config.get("reddit_subreddits", [])
        if not keywords and not subreddit_urls:
            return []

        num_per_kw = config.get("max_posts_per_keyword") or config.get("max_calls", 2) * 10
        time_range = config.get("time_range", {})
        start = time_range.get("start", "")
        reddit_date = _iso_date_to_reddit_filter(start)

        all_results: list[dict] = []

        # Strategy 1: keyword-based discovery (preferred when keywords provided)
        if keywords:
            inputs = [
                {"keyword": kw, "date": reddit_date}
                for kw in keywords
            ]
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["reddit"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw,
            )
            all_results.extend(results)

        # Strategy 2: subreddit URL discovery (when explicit subreddits provided)
        if subreddit_urls:
            inputs = []
            for url in subreddit_urls:
                if not url.startswith("http"):
                    url = f"https://www.reddit.com/r/{url}/"
                inputs.append({"url": url, "num_of_posts": num_per_kw})
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["reddit"]["posts"],
                inputs=inputs,
                discover_by="subreddit_url",
            )
            all_results.extend(results)

        # Filter out error objects and deduplicate by post_id
        seen_ids: set[str] = set()
        valid: list[dict] = []
        for item in all_results:
            if item.get("error"):
                continue
            pid = str(item.get("post_id", ""))
            if pid and pid in seen_ids:
                continue
            if pid:
                seen_ids.add(pid)
            valid.append(item)

        return self._parse_results("reddit", valid)

    # ------------------------------------------------------------------
    # Shared parsing
    # ------------------------------------------------------------------

    def _parse_results(self, platform: str, results: list[dict]) -> list[Batch]:
        """Parse raw results into a single Batch, deduplicating channels."""
        if not results:
            return []

        parse_post, parse_channel = self._PLATFORM_PARSERS[platform]
        posts: list[Post] = []
        channels_seen: dict[str, Channel] = {}

        for item in results:
            try:
                post = parse_post(item)
                posts.append(post)
                channel = parse_channel(item)
                if channel.channel_id and channel.channel_id not in channels_seen:
                    channels_seen[channel.channel_id] = channel
            except Exception:
                logger.warning("Failed to parse BrightData %s item, skipping", platform, exc_info=True)

        # Safety net: drop posts with empty post_id (malformed BD items)
        before_count = len(posts)
        posts = [p for p in posts if p.post_id]
        if len(posts) < before_count:
            logger.warning(
                "BrightData %s: dropped %d posts with empty post_id",
                platform, before_count - len(posts),
            )

        if not posts:
            return []
        return [Batch(posts=posts, channels=list(channels_seen.values()))]

    # ------------------------------------------------------------------
    # Engagement refresh
    # ------------------------------------------------------------------

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        """Re-fetch engagement metrics via Bright Data's URL collection mode."""
        if not post_urls:
            return []

        # Group URLs by platform
        platform_urls: dict[str, list[str]] = {}
        for url in post_urls:
            platform = _detect_platform_from_url(url)
            if platform and platform in self._DATASET_IDS:
                platform_urls.setdefault(platform, []).append(url)

        results: list[dict] = []
        for platform, urls in platform_urls.items():
            try:
                inputs = [{"URL": url} for url in urls]
                data = self._client.scrape_and_wait(
                    dataset_id=self._DATASET_IDS[platform]["posts"],
                    inputs=inputs,
                    discover_by="url",
                )
                for item in data:
                    eng = self._extract_engagement(platform, item)
                    if eng:
                        results.append(eng)
            except BrightDataAPIError as e:
                logger.error("BrightData engagement refresh failed for %s: %s", platform, e)

        return results

    def _extract_engagement(self, platform: str, item: dict) -> dict | None:
        """Extract engagement metrics from a Bright Data response item."""
        from workers.collection.adapters.brightdata_parsers import _safe_int

        if platform == "tiktok":
            return {
                "post_url": item.get("url", ""),
                "likes": _safe_int(item.get("digg_count")),
                "shares": _safe_int(item.get("share_count")),
                "comments_count": _safe_int(item.get("comment_count")),
                "views": _safe_int(item.get("play_count")),
                "saves": _safe_int(item.get("collect_count")),
                "comments": [],
            }
        elif platform == "youtube":
            return {
                "post_url": item.get("url", ""),
                "likes": _safe_int(item.get("likes")),
                "shares": None,
                "comments_count": _safe_int(item.get("num_comments")),
                "views": _safe_int(item.get("views")),
                "saves": None,
                "comments": [],
            }
        elif platform == "reddit":
            return {
                "post_url": item.get("url", ""),
                "likes": _safe_int(item.get("num_upvotes")),
                "shares": None,
                "comments_count": _safe_int(item.get("num_comments")),
                "views": None,
                "saves": None,
                "comments": [],
            }
        return None


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def _to_bd_date_mmddyyyy(date_str: str | None) -> str:
    """Convert YYYY-MM-DD to MM-DD-YYYY (Bright Data YouTube format)."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%m-%d-%Y")
    except ValueError:
        return date_str


def _iso_date_to_reddit_filter(date_str: str) -> str:
    """Convert an ISO date (YYYY-MM-DD) to the closest Reddit time filter label.

    Reddit's Bright Data dataset accepts: "Past hour", "Today", "Past week",
    "Past month", "Past year", "All time".
    """
    if not date_str:
        return "All time"
    try:
        start = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return "All time"

    delta = datetime.now() - start
    days = delta.days

    if days <= 0:
        return "Today"
    elif days <= 1:
        return "Today"
    elif days <= 7:
        return "Past week"
    elif days <= 30:
        return "Past month"
    elif days <= 365:
        return "Past year"
    else:
        return "All time"


def _detect_platform_from_url(url: str) -> str | None:
    domain_map = {
        "tiktok.com": "tiktok",
        "youtube.com": "youtube",
        "youtu.be": "youtube",
        "reddit.com": "reddit",
    }
    for domain, platform in domain_map.items():
        if domain in url:
            return platform
    return None
