"""Bright Data dataset scraping API adapter.

Supports: TikTok, YouTube, Reddit.

Uses Bright Data's async trigger → poll → download lifecycle.
Each keyword gets a separate API call (parallelized) to ensure per-keyword result quotas.
Platforms are collected in parallel via ThreadPoolExecutor.
"""

import logging
import queue
import re
import threading
from collections.abc import Iterator
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
_MAX_WORKERS_KEYWORDS = 5


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

    @property
    def collection_errors(self) -> list[dict]:
        return list(self._collection_errors)

    def collect(self, config: dict) -> Iterator[Batch]:
        """Collect from all assigned platforms in parallel, yielding batches as they arrive."""
        self._platform_stats = {}
        platforms = [p for p in config.get("platforms", []) if p in self.supported_platforms()]
        logger.info("BrightData collect: platforms=%s", platforms)
        if not platforms:
            return

        collector_map = {
            "tiktok": self._collect_tiktok,
            "youtube": self._collect_youtube,
            "reddit": self._collect_reddit,
        }

        batch_queue: queue.Queue = queue.Queue()

        def _run_platform(platform: str):
            """Run a platform collector, putting batches into the queue as they arrive."""
            post_count = 0
            batch_count = 0
            try:
                for batch in collector_map[platform](config):
                    post_count += len(batch.posts)
                    batch_count += 1
                    batch_queue.put(("batch", platform, batch))
                with self._stats_lock:
                    self._platform_stats[platform] = {
                        "posts": post_count,
                        "batches": batch_count,
                        "errors": 0,
                    }
                logger.info("[%s] collected %d posts", platform, post_count)
            except BrightDataAPIError as e:
                error_detail = {
                    "platform": platform,
                    "error_type": "BrightDataAPIError",
                    "message": str(e),
                    "status_code": getattr(e, "status_code", None),
                    "snapshot_id": getattr(e, "snapshot_id", None),
                }
                with self._stats_lock:
                    self._collection_errors.append(error_detail)
                    self._platform_stats[platform] = {"posts": 0, "batches": 0, "errors": 1, "error": str(e)}
                logger.error("BrightData API error for %s: %s", platform, e)
            except Exception as e:
                error_detail = {
                    "platform": platform,
                    "error_type": type(e).__name__,
                    "message": str(e),
                }
                with self._stats_lock:
                    self._collection_errors.append(error_detail)
                    self._platform_stats[platform] = {"posts": 0, "batches": 0, "errors": 1, "error": str(e)}
                logger.exception("Unexpected error collecting %s via BrightData", platform)
            finally:
                batch_queue.put(("done", platform, None))

        with ThreadPoolExecutor(max_workers=min(len(platforms), _MAX_WORKERS_PLATFORMS)) as pool:
            for p in platforms:
                pool.submit(_run_platform, p)

            remaining = len(platforms)
            while remaining > 0:
                msg_type, platform, payload = batch_queue.get()
                if msg_type == "batch":
                    yield payload
                elif msg_type == "done":
                    remaining -= 1

    # ------------------------------------------------------------------
    # TikTok
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        if not keywords:
            return

        num_per_kw = config.get("max_posts_per_keyword", 20)
        geo = config.get("geo_scope", "")
        if geo == "global":
            geo = ""

        def _fetch_keyword(kw: str) -> list[dict]:
            inputs = [{"search_keyword": kw, "num_of_posts": num_per_kw, "country": geo}]
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["tiktok"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw,
            )
            valid = [r for r in results if not r.get("error")]
            errors = len(results) - len(valid)
            logger.info(
                "[tiktok] kw=%r → %d/%d posts%s",
                kw, len(valid), len(results),
                f" ({errors} errors)" if errors else "",
            )
            return valid

        # Fetch each keyword separately — yield a batch as soon as each keyword completes
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {pool.submit(_fetch_keyword, kw): kw for kw in keywords}
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    results = future.result()
                    for batch in self._parse_results("tiktok", results):
                        yield batch
                except BrightDataAPIError as e:
                    logger.error("BrightData TikTok keyword '%s' failed: %s", kw, e)
                except Exception:
                    logger.exception("Unexpected error fetching TikTok keyword '%s'", kw)

    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------

    def _collect_youtube(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        if not keywords:
            return

        num_per_kw = config.get("max_posts_per_keyword", 20)
        time_range = config.get("time_range", {})
        start = _to_bd_date_mmddyyyy(time_range.get("start"))
        end = _to_bd_date_mmddyyyy(time_range.get("end"))

        def _fetch_keyword(kw: str) -> list[dict]:
            inputs = [
                {
                    "keyword": kw,
                    "num_of_posts": str(num_per_kw),  # YouTube requires string
                    "start_date": start,
                    "end_date": end,
                    "country": "",
                }
            ]
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["youtube"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw,
            )
            valid = [r for r in results if not r.get("error")]
            errors = len(results) - len(valid)
            logger.info(
                "[youtube] kw=%r → %d/%d posts%s",
                kw, len(valid), len(results),
                f" ({errors} errors)" if errors else "",
            )
            return valid

        # Fetch each keyword separately — yield a batch as soon as each keyword completes
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {pool.submit(_fetch_keyword, kw): kw for kw in keywords}
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    results = future.result()
                    for batch in self._parse_results("youtube", results):
                        yield batch
                except BrightDataAPIError as e:
                    logger.error("BrightData YouTube keyword '%s' failed: %s", kw, e)
                except Exception:
                    logger.exception("Unexpected error fetching YouTube keyword '%s'", kw)

    # ------------------------------------------------------------------
    # Reddit
    # ------------------------------------------------------------------

    def _collect_reddit(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        subreddit_urls = config.get("reddit_subreddits", [])
        if not keywords and not subreddit_urls:
            return

        num_per_kw = config.get("max_posts_per_keyword", 20)
        time_range = config.get("time_range", {})
        start = time_range.get("start", "")
        reddit_date = _iso_date_to_reddit_filter(start)

        all_results: list[dict] = []

        # Strategy 1: keyword-based discovery (preferred when keywords provided)
        if keywords:
            inputs = [
                {"keyword": kw, "date": reddit_date, "num_of_posts": num_per_kw}
                for kw in keywords
            ]
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["reddit"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw,
            )
            logger.info("[reddit] keywords (%d) → %d raw results", len(keywords), len(results))
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
                limit_per_input=num_per_kw,
            )
            logger.info("[reddit] subreddits (%d) → %d raw results", len(subreddit_urls), len(results))
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

        yield from self._parse_results("reddit", valid)

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
