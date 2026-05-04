"""Apify actor-based adapter.

Supports: Instagram, Facebook, TikTok.

Uses the apify-client Python SDK in synchronous mode (start → block on
.call() until the actor finishes → iterate dataset items). Each platform
maps to a configurable actor ID via env, with a parser registered per
(platform, actor_id) — swapping actors is an env change *plus* a parser
registration.

Time-window correctness: server-side filters are passed to the actor when
supported (cost), and a client-side gate runs after parsing (correctness).
TikTok is an exception — we deliberately collect against TikTok's "Top"
section without a date filter so we get engagement-ranked results across
the brand's full history (most viral posts are not from the past 7 days).
The client-side time gate is therefore skipped for TikTok.

Concurrency: parallel actor runs are capped by `apify_max_parallel_runs`,
which combined with `apify_memory_mbytes` must stay under the account-level
memory cap (8 GB on this account by default).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient, ApifyAPIError
from workers.collection.adapters.apify_parsers import get_parsers
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.models import Batch, Channel, Post

logger = logging.getLogger(__name__)


def _days_since(date_str: str | None) -> int:
    """Days between `date_str` (YYYY-MM-DD or ISO) and now. 0 on parse failure."""
    if not date_str:
        return 0
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return 0
    return max(0, (datetime.now(timezone.utc) - dt).days)


def _to_yyyymmdd(value: str | None) -> str | None:
    """Normalize an ISO timestamp or date string to YYYY-MM-DD. None on failure."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.strftime("%Y-%m-%d")


def _hashtag_url(keyword: str) -> str:
    """Build an Instagram hashtag URL from a keyword.

    Strips the leading '#' if present and any whitespace; the actor's URL
    parser rejects spaces, so callers should pre-clean keywords if needed.
    """
    clean = keyword.lstrip("#").strip().replace(" ", "")
    return f"https://www.instagram.com/explore/tags/{clean}/"


class ApifyAdapter(DataProviderAdapter):
    """Wraps Apify actors for Instagram, Facebook, TikTok."""

    _SUPPORTED = ["instagram", "facebook", "tiktok"]

    _BATCH_SIZE = 50  # mirror BrightDataAdapter sub-batch size

    def __init__(self):
        s = get_settings()
        if not s.apify_api_token:
            raise ValueError("APIFY_API_TOKEN not configured")

        # Memory cap guard: parallel * per-run-memory must fit account cap.
        if s.apify_max_parallel_runs * s.apify_memory_mbytes > s.apify_account_memory_cap_mbytes:
            raise ValueError(
                f"Apify config exceeds account memory cap: "
                f"max_parallel_runs={s.apify_max_parallel_runs} * memory_mbytes={s.apify_memory_mbytes} "
                f"= {s.apify_max_parallel_runs * s.apify_memory_mbytes} > {s.apify_account_memory_cap_mbytes}. "
                f"Lower APIFY_MAX_PARALLEL_RUNS or APIFY_MEMORY_MBYTES."
            )

        self._client = ApifyAdapterClient(s.apify_api_token)

        self._actor_ids: dict[str, str] = {
            "instagram": s.apify_actor_instagram,
            "facebook": s.apify_actor_facebook,
            "tiktok": s.apify_actor_tiktok,
        }
        # Resolve parsers at init — fail fast if any configured actor has no entry.
        self._parsers = {
            platform: get_parsers(platform, actor_id)
            for platform, actor_id in self._actor_ids.items()
        }

        self._timeout_secs = s.apify_run_timeout_sec
        self._memory_mbytes = s.apify_memory_mbytes
        self._build = s.apify_build
        self._proxy_group = s.apify_proxy_group
        self._max_parallel = max(1, s.apify_max_parallel_runs)
        self._max_runs = s.apify_max_runs_per_collection

        # Per-collection state — reset at the top of collect().
        self._stats_lock = threading.Lock()
        self._runs_used = 0
        self._collection_errors: list[dict] = []
        self._platform_stats: dict[str, dict] = {}
        self._funnel: dict = self._fresh_funnel()

        logger.info(
            "ApifyAdapter initialized: actors=%s memory_mb=%d max_parallel=%d max_runs=%d",
            self._actor_ids, self._memory_mbytes, self._max_parallel, self._max_runs,
        )

    @staticmethod
    def _fresh_funnel() -> dict:
        return {
            "apify_runs_triggered": 0,
            "apify_runs_succeeded": 0,
            "apify_runs_failed": 0,
            "apify_runs_budget_exhausted": 0,
            "apify_raw_records": 0,
            "apify_filtered_by_time_window": 0,
            "apify_parse_failures": 0,
            "apify_valid_posts": 0,
            "per_platform": {},
        }

    def supported_platforms(self) -> list[str]:
        return list(self._SUPPORTED)

    @property
    def platform_stats(self) -> dict[str, dict]:
        return dict(self._platform_stats)

    @property
    def collection_errors(self) -> list[dict]:
        return list(self._collection_errors)

    @property
    def funnel_stats(self) -> dict:
        with self._stats_lock:
            return dict(self._funnel)

    # ------------------------------------------------------------------
    # Run-budget enforcement (mirrors BrightData snapshot budget)
    # ------------------------------------------------------------------

    def _claim_run(self) -> bool:
        with self._stats_lock:
            if self._runs_used >= self._max_runs:
                self._funnel["apify_runs_budget_exhausted"] += 1
                logger.warning(
                    "Apify run budget exhausted: %d/%d — skipping further runs",
                    self._runs_used, self._max_runs,
                )
                return False
            self._runs_used += 1
            self._funnel["apify_runs_triggered"] += 1
            return True

    def _record_success(self) -> None:
        with self._stats_lock:
            self._funnel["apify_runs_succeeded"] += 1

    def _record_failure(self, platform: str, exc: Exception) -> None:
        with self._stats_lock:
            self._funnel["apify_runs_failed"] += 1
            self._collection_errors.append({
                "platform": platform,
                "error_type": type(exc).__name__,
                "message": str(exc),
                "vendor": "apify",
            })

    # ------------------------------------------------------------------
    # Public collect()
    # ------------------------------------------------------------------

    def collect(self, config: dict) -> Iterator[Batch]:
        # Reset per-collection state
        self._runs_used = 0
        self._collection_errors = []
        self._platform_stats = {}
        self._funnel = self._fresh_funnel()

        platforms = [p for p in config.get("platforms", []) if p in self._SUPPORTED]
        if not platforms:
            return

        collectors = {
            "instagram": self._collect_instagram,
            "facebook": self._collect_facebook,
            "tiktok": self._collect_tiktok,
        }

        # Run platforms in parallel — each platform owns its own keyword fan-out.
        # Cap concurrency at max_parallel so total in-flight actor memory stays
        # under the account cap.
        with ThreadPoolExecutor(max_workers=min(len(platforms), self._max_parallel)) as pool:
            futures = {pool.submit(collectors[p], config): p for p in platforms}
            for future in as_completed(futures):
                platform = futures[future]
                try:
                    for batch in future.result():
                        yield batch
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Apify %s collection failed", platform)
                    self._record_failure(platform, exc)

    # ------------------------------------------------------------------
    # Instagram — apify/instagram-scraper
    #   Schema requires either `directUrls` or `search` (single string).
    #   We map keywords → hashtag URLs and pass them as `directUrls`, which
    #   keeps multi-keyword crawls in one run and returns posts directly
    #   (the `search` mode discovers hashtags, then fans out separately).
    # ------------------------------------------------------------------

    def _collect_instagram(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", []) or []
        channel_urls = config.get("channel_urls", []) or []
        if not keywords and not channel_urls:
            logger.info("[apify/instagram] no keywords or channel_urls — skipping")
            return []

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 0

        direct_urls = [_hashtag_url(k) for k in keywords if k] + [
            u for u in channel_urls if isinstance(u, str) and u
        ]

        run_input: dict = {
            "directUrls": direct_urls,
            "resultsType": "posts",
            "addParentData": False,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }
        if n_posts > 0:
            run_input["resultsLimit"] = n_posts
        if time_range.get("start"):
            days = _days_since(time_range["start"])
            if days > 0:
                run_input["onlyPostsNewerThan"] = f"{days} days"

        logger.info(
            "[apify/instagram] %d urls (%d hashtags + %d channels) limit=%d",
            len(direct_urls), len(keywords), len(channel_urls), n_posts,
        )
        return self._run_and_parse("instagram", run_input, config)

    # ------------------------------------------------------------------
    # Facebook — scrapeforge/facebook-search-posts
    #   Schema accepts a single `query` string per run. Fan out one run per
    #   keyword (parallelism capped by the adapter's run budget). Each run
    #   takes precise `start_date` / `end_date` (YYYY-MM-DD).
    # ------------------------------------------------------------------

    def _collect_facebook(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/facebook] no keywords — skipping")
            return []

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 5

        start_date = _to_yyyymmdd(time_range.get("start"))
        end_date = _to_yyyymmdd(time_range.get("end"))

        # Fan out across keywords using the shared parallelism cap. Each
        # keyword is one actor run.
        results: list[Batch] = []
        with ThreadPoolExecutor(max_workers=self._max_parallel) as pool:
            futures = []
            for kw in keywords:
                run_input: dict = {
                    "query": kw,
                    "search_type": "posts",
                    "max_results": n_posts,
                    "recent_posts": True,
                }
                if start_date:
                    run_input["start_date"] = start_date
                if end_date:
                    run_input["end_date"] = end_date
                futures.append(pool.submit(self._run_and_parse, "facebook", run_input, config))
            for fut in as_completed(futures):
                try:
                    results.extend(fut.result())
                except Exception as exc:  # noqa: BLE001
                    logger.exception("[apify/facebook] keyword fan-out task failed")
                    self._record_failure("facebook", exc)
        return results

    # ------------------------------------------------------------------
    # TikTok — clockworks/tiktok-scraper
    #   Hits TikTok's default "Top" search section (engagement-ranked).
    #   We deliberately skip date filtering: the actor's `oldest/newest`
    #   params are silently ignored for `searchQueries` (validated against
    #   chargedEventCounts → `filter-applied: 0`), and the Top section's
    #   high-engagement results span the brand's full history. A client-side
    #   date gate would just discard posts we already paid for.
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/tiktok] no keywords — skipping")
            return []

        n_posts = config.get("max_posts_per_keyword") or 0

        run_input: dict = {
            "searchQueries": keywords,
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSlideshowImages": False,
            "shouldDownloadAvatars": False,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }
        if n_posts > 0:
            run_input["resultsPerPage"] = n_posts

        logger.info(
            "[apify/tiktok] keywords=%d limit_per_query=%d (Top section, no date filter)",
            len(keywords), n_posts,
        )
        return self._run_and_parse("tiktok", run_input, config, apply_time_gate=False)

    # ------------------------------------------------------------------
    # Shared run + parse + gate
    # ------------------------------------------------------------------

    def _run_and_parse(
        self,
        platform: str,
        run_input: dict,
        config: dict,
        *,
        apply_time_gate: bool = True,
    ) -> list[Batch]:
        """Trigger one actor run, iterate the dataset, parse, time-gate, batch."""
        if not self._claim_run():
            return []

        actor_id = self._actor_ids[platform]
        started = time.monotonic()
        try:
            run = self._client.run_actor(
                actor_id=actor_id,
                run_input=run_input,
                timeout_secs=self._timeout_secs,
                memory_mbytes=self._memory_mbytes,
                build=self._build,
            )
        except ApifyAPIError as exc:
            logger.error("Apify %s run failed: %s", platform, exc)
            self._record_failure(platform, exc)
            return []
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error launching Apify %s run", platform)
            self._record_failure(platform, exc)
            return []

        self._record_success()

        dataset_id = run.get("defaultDatasetId", "")
        raw_items = list(self._client.iter_dataset_items(dataset_id))
        elapsed = time.monotonic() - started
        logger.info(
            "[apify/%s] run %s → %d raw records in %.1fs",
            platform, run.get("id"), len(raw_items), elapsed,
        )

        with self._stats_lock:
            self._funnel["apify_raw_records"] += len(raw_items)

        return self._parse_results(platform, raw_items, config, apply_time_gate=apply_time_gate)

    def _parse_results(
        self,
        platform: str,
        raw_items: list[dict],
        config: dict,
        *,
        apply_time_gate: bool = True,
    ) -> list[Batch]:
        if not raw_items:
            return []

        parse_post, parse_channel = self._parsers[platform]
        time_range = config.get("time_range", {}) or {}
        gate_start = self._parse_iso(time_range.get("start")) if apply_time_gate else None
        gate_end = self._parse_iso(time_range.get("end")) if apply_time_gate else None

        posts: list[Post] = []
        channels: dict[str, Channel] = {}
        seen_ids: set[str] = set()
        parse_failures = 0
        time_filtered = 0

        for item in raw_items:
            try:
                post = parse_post(item)
            except Exception:  # noqa: BLE001
                parse_failures += 1
                logger.warning("Apify %s parse failure", platform, exc_info=True)
                continue

            if not post.post_id:
                parse_failures += 1
                continue
            if post.post_id in seen_ids:
                continue
            seen_ids.add(post.post_id)

            # Client-side time gate — server-side filters are coarse for TikTok
            # (bucketed) and approximate for IG/FB (relative duration). Drop
            # anything outside the precise window.
            if gate_start and post.posted_at < gate_start:
                time_filtered += 1
                continue
            if gate_end and post.posted_at > gate_end:
                time_filtered += 1
                continue

            posts.append(post)
            try:
                ch = parse_channel(item)
                if ch.channel_id and ch.channel_id not in channels:
                    channels[ch.channel_id] = ch
            except Exception:  # noqa: BLE001
                logger.debug("Apify %s channel parse skipped", platform, exc_info=True)

        with self._stats_lock:
            self._funnel["apify_parse_failures"] += parse_failures
            self._funnel["apify_filtered_by_time_window"] += time_filtered
            self._funnel["apify_valid_posts"] += len(posts)
            self._funnel["per_platform"][platform] = {
                "raw_records": len(raw_items),
                "parse_failures": parse_failures,
                "filtered_by_time_window": time_filtered,
                "valid_posts": len(posts),
            }
            self._platform_stats[platform] = {
                "posts": len(posts),
                "batches": (len(posts) + self._BATCH_SIZE - 1) // self._BATCH_SIZE,
                "errors": 0,
            }

        logger.info(
            "[apify/%s] %d raw → %d valid posts (parse_fail=%d time_filtered=%d)",
            platform, len(raw_items), len(posts), parse_failures, time_filtered,
        )

        if not posts:
            return []

        all_channels = list(channels.values())
        batches: list[Batch] = []
        for i in range(0, len(posts), self._BATCH_SIZE):
            chunk = posts[i:i + self._BATCH_SIZE]
            chunk_channel_ids = {p.channel_id for p in chunk if p.channel_id}
            chunk_channels = [c for c in all_channels if c.channel_id in chunk_channel_ids]
            batches.append(Batch(posts=chunk, channels=chunk_channels))
        return batches

    @staticmethod
    def _parse_iso(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    # ------------------------------------------------------------------
    # Engagement refresh — one batched run per platform via directUrls.
    # ------------------------------------------------------------------

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        if not post_urls:
            return []

        # Group URLs by platform so we can fan to the right actor.
        platform_urls: dict[str, list[str]] = {}
        for url in post_urls:
            platform = _detect_platform_from_url(url)
            if platform in self._SUPPORTED:
                platform_urls.setdefault(platform, []).append(url)

        results: list[dict] = []
        for platform, urls in platform_urls.items():
            try:
                results.extend(self._refresh_platform_engagements(platform, urls))
            except Exception:  # noqa: BLE001
                logger.exception("Apify engagement refresh failed for %s", platform)
        return results

    def _refresh_platform_engagements(self, platform: str, urls: list[str]) -> list[dict]:
        if not self._claim_run():
            return []

        if platform == "instagram":
            run_input = {
                "directUrls": urls,
                "resultsType": "posts",
                "proxyConfiguration": {"useApifyProxy": True, "apifyProxyGroups": [self._proxy_group]},
            }
        elif platform == "facebook":
            run_input = {
                "startUrls": [{"url": u} for u in urls],
                "proxyConfiguration": {"useApifyProxy": True, "apifyProxyGroups": [self._proxy_group]},
            }
        elif platform == "tiktok":
            run_input = {
                "postURLs": urls,
                "proxyConfiguration": {"useApifyProxy": True, "apifyProxyGroups": [self._proxy_group]},
            }
        else:
            return []

        actor_id = self._actor_ids[platform]
        try:
            run = self._client.run_actor(
                actor_id=actor_id,
                run_input=run_input,
                timeout_secs=self._timeout_secs,
                memory_mbytes=self._memory_mbytes,
                build=self._build,
            )
        except ApifyAPIError as exc:
            logger.error("Apify %s engagement refresh failed: %s", platform, exc)
            self._record_failure(platform, exc)
            return []

        self._record_success()

        parse_post, _ = self._parsers[platform]
        out: list[dict] = []
        for item in self._client.iter_dataset_items(run.get("defaultDatasetId", "")):
            try:
                post = parse_post(item)
            except Exception:  # noqa: BLE001
                logger.warning("Apify %s engagement parse failure", platform, exc_info=True)
                continue
            out.append({
                "post_url": post.post_url,
                "likes": post.likes,
                "shares": post.shares,
                "comments_count": post.comments_count,
                "views": post.views,
                "saves": post.saves,
                "comments": [],
            })
        return out


def _detect_platform_from_url(url: str) -> str | None:
    if not isinstance(url, str):
        return None
    if "instagram.com" in url:
        return "instagram"
    if "tiktok.com" in url:
        return "tiktok"
    if "facebook.com" in url or "fb.com" in url:
        return "facebook"
    return None
