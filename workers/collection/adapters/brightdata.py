"""Bright Data dataset scraping API adapter.

Supports: TikTok, YouTube, Reddit.

Uses Bright Data's async trigger → poll → download lifecycle.
Each keyword gets a separate API call (parallelized) to ensure per-keyword result quotas.
Platforms are collected in parallel via ThreadPoolExecutor.
"""

import logging
import queue
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
_MAX_WORKERS_KEYWORDS = 10


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

    def __init__(self, snapshot_tracker: "callable | None" = None, max_snapshots: int = 0):
        settings = get_settings()
        if not settings.brightdata_api_token:
            raise ValueError("BRIGHTDATA_API_TOKEN not configured")
        self._client = BrightDataClient(
            api_token=settings.brightdata_api_token,
            poll_max_wait_sec=settings.brightdata_poll_max_wait_sec,
            poll_initial_interval_sec=settings.brightdata_poll_initial_interval_sec,
        )
        self._snapshot_tracker = snapshot_tracker
        self._platform_stats: dict[str, dict] = {}
        self._collection_errors: list[dict] = []
        self._stats_lock = threading.Lock()
        # Snapshot budget enforcement
        self._max_snapshots = max_snapshots or settings.brightdata_max_snapshots_per_collection
        self._snapshot_count = 0
        self._snapshot_count_lock = threading.Lock()
        logger.info("BrightDataAdapter initialized (max_snapshots=%d)", self._max_snapshots)

    def _check_snapshot_budget(self) -> bool:
        """Return True if we can trigger another snapshot, False if budget exhausted."""
        with self._snapshot_count_lock:
            if self._snapshot_count >= self._max_snapshots:
                logger.warning(
                    "Snapshot budget exhausted: %d/%d used — skipping further scrapes",
                    self._snapshot_count, self._max_snapshots,
                )
                return False
            self._snapshot_count += 1
            return True

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
        self._collection_errors = []
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

        num_per_kw = config.get("max_posts_per_keyword") or 0

        logger.info(
            "[tiktok] keywords: %s, num_per_kw=%s, expected_max=%s",
            keywords, num_per_kw or "unlimited",
            (num_per_kw * len(keywords)) if num_per_kw else "unlimited",
        )

        def _fetch_tiktok_keyword(kw: str) -> list[dict]:
            if not self._check_snapshot_budget():
                return []
            inp: dict = {"search_keyword": kw}
            if num_per_kw > 0:
                inp["num_of_posts"] = num_per_kw
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["tiktok"]["posts"],
                inputs=[inp],
                discover_by="keyword",
                limit_per_input=num_per_kw if num_per_kw > 0 else None,
                snapshot_callback=self._snapshot_tracker,
            )
            valid = [r for r in results if not _is_error_item(r)]
            logger.info("[tiktok] keyword %r → %d/%d posts", kw, len(valid), len(results))
            return valid

        all_results: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(len(keywords), _MAX_WORKERS_KEYWORDS)) as pool:
            futures = {
                pool.submit(_fetch_tiktok_keyword, kw): kw
                for kw in keywords
            }
            for future in as_completed(futures):
                kw = futures[future]
                try:
                    all_results.extend(future.result())
                except BrightDataAPIError as e:
                    logger.error("BrightData TikTok keyword %r failed: %s", kw, e)
                except Exception:
                    logger.exception("Unexpected error fetching TikTok keyword %r", kw)

        if not all_results:
            return

        for batch in self._parse_results("tiktok", all_results):
            yield batch

    # ------------------------------------------------------------------
    # YouTube
    # ------------------------------------------------------------------

    def _collect_youtube(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        if not keywords:
            return

        num_per_kw = config.get("max_posts_per_keyword") or 0
        time_range = config.get("time_range", {})
        start = _to_bd_date_mmddyyyy(time_range.get("start"))
        end = _to_bd_date_mmddyyyy(time_range.get("end"))

        logger.info(
            "[youtube] keywords=%s, num_per_kw=%s, date_range=%s→%s, "
            "expected_max=%s",
            keywords, num_per_kw or "unlimited", start, end,
            (num_per_kw * len(keywords)) if num_per_kw else "unlimited",
        )

        inputs = []
        for kw in keywords:
            inp: dict = {"keyword": kw, "start_date": start, "end_date": end}
            if num_per_kw > 0:
                inp["num_of_posts"] = num_per_kw
            inputs.append(inp)

        all_results: list[dict] = []
        if not self._check_snapshot_budget():
            return
        try:
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["youtube"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw if num_per_kw > 0 else None,
                snapshot_callback=self._snapshot_tracker,
            )
            valid = [r for r in results if not _is_error_item(r)]
            logger.info("[youtube] keyword batch → %d/%d posts", len(valid), len(results))
            all_results.extend(valid)
        except BrightDataAPIError as e:
            logger.error("BrightData YouTube keyword batch failed: %s", e)
        except Exception:
            logger.exception("Unexpected error fetching YouTube keyword batch")

        if not all_results:
            return

        # Dedup handled in _parse_results
        for batch in self._parse_results("youtube", all_results):
            yield batch

    # ------------------------------------------------------------------
    # Reddit
    # ------------------------------------------------------------------

    def _collect_reddit(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", [])
        subreddit_urls = config.get("reddit_subreddits", [])
        if not keywords and not subreddit_urls:
            return

        num_per_kw = config.get("max_posts_per_keyword") or 0
        time_range = config.get("time_range", {})
        start = time_range.get("start", "")
        reddit_date = _iso_date_to_reddit_filter(start)
        logger.info(
            "[reddit] keywords=%s, subreddits=%s, num_per_kw=%s, date_filter=%s",
            keywords, subreddit_urls, num_per_kw or "unlimited", reddit_date,
        )

        all_results: list[dict] = []

        # Strategy 1: keyword-based discovery (preferred when keywords provided)
        if keywords and self._check_snapshot_budget():
            inputs = []
            for kw in keywords:
                inp: dict = {"keyword": kw, "date": reddit_date}
                if num_per_kw > 0:
                    inp["num_of_posts"] = num_per_kw
                inputs.append(inp)
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["reddit"]["posts"],
                inputs=inputs,
                discover_by="keyword",
                limit_per_input=num_per_kw if num_per_kw > 0 else None,
                snapshot_callback=self._snapshot_tracker,
            )
            logger.info("[reddit] keywords (%d) → %d raw results", len(keywords), len(results))
            all_results.extend(results)

        # Strategy 2: subreddit URL discovery (when explicit subreddits provided)
        if subreddit_urls and self._check_snapshot_budget():
            inputs = []
            for url in subreddit_urls:
                if not url.startswith("http"):
                    url = f"https://www.reddit.com/r/{url}/"
                sub_inp: dict = {"url": url}
                if num_per_kw > 0:
                    sub_inp["num_of_posts"] = num_per_kw
                inputs.append(sub_inp)
            results = self._client.scrape_and_wait(
                dataset_id=self._DATASET_IDS["reddit"]["posts"],
                inputs=inputs,
                discover_by="subreddit_url",
                limit_per_input=num_per_kw if num_per_kw > 0 else None,
                snapshot_callback=self._snapshot_tracker,
            )
            logger.info("[reddit] subreddits (%d) → %d raw results", len(subreddit_urls), len(results))
            all_results.extend(results)

        # Filter out error objects and deduplicate by post_id
        seen_ids: set[str] = set()
        valid: list[dict] = []
        for item in all_results:
            if _is_error_item(item):
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

    _BATCH_SIZE = 50  # Sub-batch size for progressive enrichment

    def _parse_results(self, platform: str, results: list[dict]) -> list[Batch]:
        """Parse raw results into sub-batches of _BATCH_SIZE for progressive enrichment.

        Deduplicates posts by post_id (important when multiple search terms
        return overlapping results).
        """
        if not results:
            return []

        parse_post, parse_channel = self._PLATFORM_PARSERS[platform]
        posts: list[Post] = []
        channels_seen: dict[str, Channel] = {}
        seen_post_ids: set[str] = set()

        for item in results:
            try:
                post = parse_post(item)
                # Dedup across keywords/hashtags
                if post.post_id and post.post_id in seen_post_ids:
                    continue
                if post.post_id:
                    seen_post_ids.add(post.post_id)
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
        deduped_count = len(results) - len(posts)
        if deduped_count > 0:
            logger.info(
                "BrightData %s: deduped %d overlapping posts (%d → %d unique)",
                platform, deduped_count, len(results), len(posts),
            )

        if not posts:
            if results:
                sample = {k: str(v)[:200] for k, v in results[0].items()}
                logger.error(
                    "BrightData %s: All %d raw results failed parsing (0 valid posts). "
                    "First item: %s",
                    platform, len(results), sample,
                )
            return []

        # Split into sub-batches for progressive enrichment
        all_channels = list(channels_seen.values())
        batches: list[Batch] = []
        for i in range(0, len(posts), self._BATCH_SIZE):
            chunk = posts[i:i + self._BATCH_SIZE]
            # Include channels relevant to this chunk
            chunk_channel_ids = {p.channel_id for p in chunk if p.channel_id}
            chunk_channels = [c for c in all_channels if c.channel_id in chunk_channel_ids]
            batches.append(Batch(posts=chunk, channels=chunk_channels))

        logger.info(
            "BrightData %s: %d posts → %d sub-batches of ~%d",
            platform, len(posts), len(batches), self._BATCH_SIZE,
        )
        return batches

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

def _is_error_item(item: dict) -> bool:
    """Check if a BrightData result item is an error object rather than real data."""
    if item.get("error"):
        return True
    # BrightData sometimes returns error objects with status/message keys instead of post data
    if "status" in item and "message" in item and len(item) <= 5:
        logger.warning("BrightData error item: %s", {k: str(v)[:200] for k, v in item.items()})
        return True
    return False


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


