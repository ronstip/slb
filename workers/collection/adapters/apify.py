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

Concurrency: a single shared `BoundedSemaphore` caps total in-flight actor
runs at `apify_max_parallel_runs` across ALL platforms within one collect()
call. Without that, a multi-platform collection would multiply parallelism by
num_platforms (each platform spawns its own keyword-fanout pool) and could
blow past the account memory cap. `max_parallel * apify_memory_mbytes` must
stay under the account-level cap (32 GB on the STARTER plan).

Streaming: TikTok and Facebook keyword fan-outs yield batches as each
keyword's actor run completes (via `as_completed`). This way a host crash
or pipeline termination still preserves all completed-keyword data — the
old behavior accumulated everything into a single list and only flushed
after every keyword finished, so killing the process mid-flight lost
already-scraped (and already-paid-for) posts.
"""

from __future__ import annotations

import logging
import math
import queue
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient, ApifyAPIError
from workers.collection.adapters.apify_parsers import get_parsers
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.models import Batch, Channel, CommentBatch, Post

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

        # Cap total in-flight actor runs across all platforms in a single
        # collect() call. Per-platform fan-outs still use their own pools
        # (with up to max_parallel workers each) but block on this semaphore
        # before actually launching an actor run, so peak memory stays
        # bounded regardless of how many platforms run concurrently.
        self._concurrent_runs = threading.BoundedSemaphore(self._max_parallel)

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

        # Run platforms in parallel via dedicated threads pushing into a shared
        # queue. A ThreadPoolExecutor would be wrong here: TikTok and Facebook
        # collectors are now generators, so their bodies don't execute until
        # iterated — submitting them to a pool would just return the generator
        # objects synchronously and serialize the work in the consumer thread.
        # The shared `_concurrent_runs` semaphore inside `_run_actor_collect_raw`
        # keeps total in-flight actor calls bounded across all platform threads.
        SENTINEL = object()
        out_q: queue.Queue = queue.Queue()

        def _drive(platform: str) -> None:
            try:
                for batch in collectors[platform](config):
                    out_q.put(batch)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Apify %s collection failed", platform)
                self._record_failure(platform, exc)
            finally:
                out_q.put(SENTINEL)

        threads = [
            threading.Thread(target=_drive, args=(p,), name=f"apify-{p}", daemon=True)
            for p in platforms
        ]
        for t in threads:
            t.start()

        pending = len(platforms)
        while pending > 0:
            item = out_q.get()
            if item is SENTINEL:
                pending -= 1
            else:
                yield item

        for t in threads:
            t.join()

    # ------------------------------------------------------------------
    # Instagram — apidojo/instagram-hashtag-scraper
    #   Single actor run with `startUrls` (hashtag URLs derived from
    #   keywords), `until` (server-side date floor), and `getReels`/`getPosts`
    #   toggles. The actor returns engagement-rich items (likeCount,
    #   commentCount, video.playCount) so we re-rank client-side by an
    #   engagement score and trim to the requested per-keyword count.
    #
    #   channel_urls is intentionally not handled here — this actor accepts
    #   hashtag URLs only. The frontend's channel_urls input is a global
    #   field shared with other platforms; for IG we now collect on
    #   keywords/hashtags only. A WARN is emitted when channel_urls arrive
    #   so the noop is visible in pipeline logs.
    # ------------------------------------------------------------------

    @staticmethod
    def _ig_engagement_score(post: Post) -> float:
        """Engagement score for IG client-side re-rank.

        Coefficients are an opening bid; tune from prod data after Stage 2.
        Comments weighted 2x because they're scarcer and more intent-y than
        likes; views weighted 0.01 so a viral Reel doesn't drown out
        higher-effort posts.
        """
        return (
            (post.likes or 0)
            + 2.0 * (post.comments_count or 0)
            + 0.01 * (post.views or 0)
        )

    def _collect_instagram(self, config: dict) -> list[Batch]:
        keywords = config.get("keywords", []) or []
        channel_urls = config.get("channel_urls", []) or []

        if channel_urls:
            logger.warning(
                "[apify/instagram] channel_urls=%d ignored — IG path is "
                "keyword-only with apidojo/instagram-hashtag-scraper",
                len(channel_urls),
            )

        if not keywords:
            logger.info("[apify/instagram] no keywords — skipping")
            return []

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 0

        # Multi-word phrases get collapsed by `_hashtag_url` (spaces removed).
        # IG falls back to prefix-match when the concat isn't a real hashtag —
        # noisy but not silent — so we send the run anyway and let enrichment
        # filter. A multi-word phrase that IS a real hashtag (#sociallistening)
        # works as expected.
        hashtag_urls = [_hashtag_url(k) for k in keywords if (k or "").strip()]
        if not hashtag_urls:
            logger.info("[apify/instagram] no usable keywords — skipping")
            return []

        run_input: dict = {
            "startUrls": hashtag_urls,
            "getReels": True,
            "getPosts": True,
        }
        if n_posts > 0:
            # Global cap across all startUrls. Actor distributes across
            # hashtags itself; we re-rank + trim client-side to enforce a
            # true per-keyword target after dedupe.
            run_input["maxItems"] = n_posts * len(hashtag_urls)
        until_yyyymmdd = _to_yyyymmdd(time_range.get("start"))
        if until_yyyymmdd:
            # Actor semantics: "posts on or after this date" (UTC midnight).
            run_input["until"] = until_yyyymmdd

        raw_items = self._run_actor_collect_raw("instagram", run_input)

        logger.info(
            "[apify/instagram] requested=%d total_raw=%d (urls=%d hashtags)",
            n_posts, len(raw_items), len(hashtag_urls),
        )

        batches = self._parse_results("instagram", raw_items, config)

        # Engagement re-rank and trim. Without this we'd return all maxItems
        # in chronological order; the user's intent is "top N by engagement
        # within the time window".
        if n_posts > 0 and batches:
            cap = n_posts * len(hashtag_urls)
            all_posts: list[Post] = [p for b in batches for p in b.posts]
            if len(all_posts) > cap:
                all_posts.sort(key=self._ig_engagement_score, reverse=True)
                all_posts = all_posts[:cap]
                kept_channel_ids = {p.channel_id for p in all_posts if p.channel_id}
                all_channels: list[Channel] = []
                seen: set[str] = set()
                for b in batches:
                    for ch in b.channels:
                        if (
                            ch.channel_id
                            and ch.channel_id in kept_channel_ids
                            and ch.channel_id not in seen
                        ):
                            all_channels.append(ch)
                            seen.add(ch.channel_id)
                batches = self._chunk_into_batches(all_posts, all_channels)

        return batches

    def _chunk_into_batches(
        self, posts: list[Post], channels: list[Channel]
    ) -> list[Batch]:
        if not posts:
            return []
        out: list[Batch] = []
        for i in range(0, len(posts), self._BATCH_SIZE):
            chunk = posts[i:i + self._BATCH_SIZE]
            chunk_channel_ids = {p.channel_id for p in chunk if p.channel_id}
            chunk_channels = [c for c in channels if c.channel_id in chunk_channel_ids]
            out.append(Batch(posts=chunk, channels=chunk_channels))
        return out

    # ------------------------------------------------------------------
    # Facebook — scrapeforge/facebook-search-posts
    #   Schema accepts a single `query` string per run. Fan out one run per
    #   keyword (parallelism capped by the adapter's run budget). Each run
    #   takes precise `start_date` / `end_date` (YYYY-MM-DD).
    # ------------------------------------------------------------------

    def _collect_facebook(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/facebook] no keywords — skipping")
            return

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 5

        start_date = _to_yyyymmdd(time_range.get("start"))
        end_date = _to_yyyymmdd(time_range.get("end"))

        # `recent_posts: False` ranks by relevance (FB's algorithm already
        # weights recency as a factor); combined with start_date/end_date this
        # yields "most relevant within window" instead of strict recency.
        # `max_results` is per-query and described as "Maximum unique results"
        # — the actor dedupes server-side, so a 1.5x buffer (capped at the
        # documented hard max of 1000) closes the under-delivery gap.
        per_query_max = min(1000, max(1, math.ceil(n_posts * 1.5))) if n_posts > 0 else n_posts

        # Fan out across keywords; yield batches as each keyword completes
        # so a host crash mid-collection still preserves finished-keyword data.
        total_parsed = 0
        with ThreadPoolExecutor(max_workers=self._max_parallel) as pool:
            futures = []
            for kw in keywords:
                run_input: dict = {
                    "query": kw,
                    "search_type": "posts",
                    "max_results": per_query_max,
                    "recent_posts": False,
                }
                if start_date:
                    run_input["start_date"] = start_date
                if end_date:
                    run_input["end_date"] = end_date
                futures.append(pool.submit(self._run_and_parse, "facebook", run_input, config))
            for fut in as_completed(futures):
                try:
                    for batch in fut.result():
                        total_parsed += len(batch.posts)
                        yield batch
                except Exception as exc:  # noqa: BLE001
                    logger.exception("[apify/facebook] keyword fan-out task failed")
                    self._record_failure("facebook", exc)

        logger.info(
            "[apify/facebook] keywords=%d requested=%d parsed=%d (max_results=%d, recent_posts=False)",
            len(keywords), n_posts * len(keywords), total_parsed, per_query_max,
        )

    # ------------------------------------------------------------------
    # TikTok — clockworks/tiktok-scraper
    #   Hits TikTok's default "Top" search section (engagement-ranked).
    #   We deliberately skip date filtering: the actor's `oldest/newest`
    #   params are silently ignored for `searchQueries` (validated against
    #   chargedEventCounts → `filter-applied: 0`), and the Top section's
    #   high-engagement results span the brand's full history. A client-side
    #   date gate would just discard posts we already paid for.
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> Iterator[Batch]:
        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/tiktok] no keywords — skipping")
            return

        n_posts = config.get("max_posts_per_keyword") or 0

        # Fan out: one actor run per keyword. A single batched run with all
        # searchQueries shares one pagination budget across queries, so
        # resultsPerPage is rarely met in practice (production logs showed
        # 9 keywords × 400 → only 516 total). Per-keyword runs each get a
        # full pagination budget. searchSection="" (Top tab) and
        # searchSorting=0 are explicit so future changes don't silently flip
        # the sort.
        base_input: dict = {
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSlideshowImages": False,
            "shouldDownloadAvatars": False,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
            "searchSection": "",
            "searchSorting": 0,
        }

        # Yield batches as each keyword's run completes. The shared
        # `_concurrent_runs` semaphore inside `_run_actor_collect_raw` caps
        # in-flight actors regardless of how wide we fan out here.
        total_parsed = 0
        with ThreadPoolExecutor(max_workers=self._max_parallel) as pool:
            futures = []
            for kw in keywords:
                run_input = {**base_input, "searchQueries": [kw]}
                if n_posts > 0:
                    run_input["resultsPerPage"] = n_posts
                futures.append(
                    pool.submit(
                        self._run_and_parse, "tiktok", run_input, config,
                        apply_time_gate=False,
                    )
                )
            for fut in as_completed(futures):
                try:
                    for batch in fut.result():
                        total_parsed += len(batch.posts)
                        yield batch
                except Exception as exc:  # noqa: BLE001
                    logger.exception("[apify/tiktok] keyword fan-out task failed")
                    self._record_failure("tiktok", exc)

        logger.info(
            "[apify/tiktok] keywords=%d requested=%d parsed=%d (Top section, no date filter)",
            len(keywords), n_posts * len(keywords), total_parsed,
        )

    # ------------------------------------------------------------------
    # Shared run + parse + gate
    # ------------------------------------------------------------------

    def _run_actor_collect_raw(self, platform: str, run_input: dict) -> list[dict]:
        """Trigger one actor run and return raw dataset items. Empty on failure.

        Centralizes run-budget claim, error capture, timing, and raw-record
        funnel accounting. Callers do their own parsing — IG uses this directly
        because it merges items from two passes before parsing once.
        """
        if not self._claim_run():
            return []

        actor_id = self._actor_ids[platform]
        started = time.monotonic()
        # Cap total in-flight actor calls across all platforms — see __init__.
        with self._concurrent_runs:
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

        # Cost telemetry — Apify reports exact USD cost on the run object.
        # Key name varies by SDK version, try both.
        try:
            from api.services.cost_meter import EVENT_PROVIDER, log_cost

            usage = run.get("usage") or {}
            reported = usage.get("totalUsageUsd")
            if reported is None:
                reported = usage.get("cost")
            if reported is not None:
                log_cost(
                    provider="apify",
                    user_id="",  # filled from collection_context if bound
                    feature="scrape",
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    units=len(raw_items),
                    unit_kind="records",
                    provider_reported_cost_usd=float(reported),
                    raw_provider_payload={
                        "actor_id": actor_id,
                        "run_id": run.get("id"),
                        "platform": platform,
                        "dataset_id": dataset_id,
                        "usage": usage,
                    },
                )
        except Exception:
            logger.warning("Failed to log apify cost", exc_info=True)

        return raw_items

    def _run_and_parse(
        self,
        platform: str,
        run_input: dict,
        config: dict,
        *,
        apply_time_gate: bool = True,
    ) -> list[Batch]:
        """Trigger one actor run, iterate the dataset, parse, time-gate, batch."""
        raw_items = self._run_actor_collect_raw(platform, run_input)
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

        return self._chunk_into_batches(posts, list(channels.values()))

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

    def fetch_comments(self, post: dict) -> CommentBatch:
        raise NotImplementedError(
            f"fetch_comments not supported by ApifyAdapter on {post.get('platform', '<unknown>')}"
        )

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

        # Cost telemetry for engagement-refresh runs (same provider-reported pattern).
        try:
            from api.services.cost_meter import EVENT_PROVIDER, log_cost

            usage = run.get("usage") or {}
            reported = usage.get("totalUsageUsd") or usage.get("cost")
            if reported is not None:
                log_cost(
                    provider="apify",
                    user_id="",
                    feature="scrape_engagement",
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    units=len(urls),
                    unit_kind="records",
                    provider_reported_cost_usd=float(reported),
                )
        except Exception:
            logger.warning("Failed to log apify engagement-refresh cost", exc_info=True)

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
