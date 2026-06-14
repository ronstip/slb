"""Apify actor-based adapter.

Supports: Instagram, Facebook, TikTok.

Uses the apify-client Python SDK in synchronous mode (start → block on
.call() until the actor finishes → iterate dataset items). Each platform
maps to a configurable actor ID via env, with a parser registered per
(platform, actor_id) - swapping actors is an env change *plus* a parser
registration.

Time-window correctness: server-side filters are passed to the actor when
supported (cost), and a client-side gate runs after parsing (correctness).
TikTok is an exception - we deliberately collect against TikTok's "Top"
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
or pipeline termination still preserves all completed-keyword data - the
old behavior accumulated everything into a single list and only flushed
after every keyword finished, so killing the process mid-flight lost
already-scraped (and already-paid-for) posts.
"""

from __future__ import annotations

import logging
import math
import queue
import re
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient, ApifyAPIError
from workers.collection.adapters.apify_parsers import (
    flatten_apify_facebook_comments,
    flatten_apify_instagram_comments,
    flatten_apify_tiktok_comments,
    flatten_apify_youtube_comments,
    get_parsers,
    parse_apify_facebook_comment_author,
    parse_apify_instagram_comment_author,
    parse_apify_tiktok_comment_author,
    parse_apify_youtube_comment_author,
)
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.comment_threading import resolve_comment_roots
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


def _normalize_ig_profile_url(raw: str) -> str | None:
    """Accept a profile URL, "@handle" or bare "handle" → full profile URL
    (apify/instagram-scraper's directUrls needs a real URL)."""
    s = (raw or "").strip()
    if not s:
        return None
    if s.startswith("http"):
        return s
    handle = s.lstrip("@").strip("/")
    return f"https://www.instagram.com/{handle}/" if handle else None


def _normalize_tiktok_profile(raw: str) -> str | None:
    """Accept a profile URL, "@handle" or bare "handle" → bare username
    (clockworks/tiktok-scraper's `profiles` field wants usernames)."""
    s = (raw or "").strip()
    if not s:
        return None
    if "tiktok.com/" in s:
        m = re.search(r"tiktok\.com/@?([^/?#]+)", s)
        return m.group(1).lstrip("@") if m else None
    return s.lstrip("@") or None


def _normalize_fb_page_url(raw: str) -> str | None:
    """Accept a page URL, "@handle" or bare "handle"/"PageName" → full FB page
    URL (apify/facebook-posts-scraper's startUrls needs a real URL)."""
    s = (raw or "").strip()
    if not s:
        return None
    if s.startswith("http"):
        return s
    handle = s.lstrip("@").strip("/")
    return f"https://www.facebook.com/{handle}" if handle else None


def _is_fb_group_url(url: str | None) -> bool:
    """True for Facebook group URLs (facebook.com/groups/...). Detect on the
    normalized URL - _normalize_fb_page_url turns a bare `groups/<id>` handle
    into a full /groups/ URL, so the `/groups/` check covers both forms.

    Groups need apify/facebook-groups-scraper; the page actor
    (apify/facebook-posts-scraper) returns NO-DATA for group feeds.
    """
    return "/groups/" in (url or "")


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
        # Resolve parsers at init - fail fast if any configured actor has no entry.
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

        # Per-collection state - reset at the top of collect().
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

    def supported_comment_platforms(self) -> list[str]:
        return list(self._COMMENTS_CONFIG.keys())

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
                    "Apify run budget exhausted: %d/%d - skipping further runs",
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
        # iterated - submitting them to a pool would just return the generator
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

        # Use context-propagating Thread so the cost-meter contextvar
        # (user/org/collection/agent) survives the parent → child hop.
        # Plain `threading.Thread` starts with a fresh default context, so
        # every log_cost in _drive would land with user_id="" agent_id=NULL.
        from api.services.cost_meter import start_thread_with_cost_context

        threads = [
            start_thread_with_cost_context(
                _drive, args=(p,), name=f"apify-{p}", daemon=True,
            )
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
    # Instagram - apidojo/instagram-hashtag-scraper
    #   Single actor run with `startUrls` (hashtag URLs derived from
    #   keywords), `until` (server-side date floor), and `getReels`/`getPosts`
    #   toggles. The actor returns engagement-rich items (likeCount,
    #   commentCount, video.playCount) so we re-rank client-side by an
    #   engagement score and trim to the requested per-keyword count.
    #
    #   channel_urls is intentionally not handled here - this actor accepts
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
        post_urls = config.get("post_urls") or []
        if post_urls:
            # Direct-fetch mode - keywords / channel_urls / time_range ignored.
            # Same actor as the keyword path; passes URLs through startUrls.
            return self._collect_instagram_by_urls(post_urls, config)

        keywords = config.get("keywords", []) or []
        channel_urls = config.get("channel_urls", []) or []

        # Channel mode: collect a profile's posts (apify/instagram-scraper, which
        # handles profile URLs - the apidojo hashtag actor can't). Keywords, if
        # present, filter the profile's posts client-side (intersection).
        if channel_urls:
            return self._collect_instagram_channels(channel_urls, config)

        if not keywords:
            logger.info("[apify/instagram] no keywords - skipping")
            return []

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 0

        # Multi-word phrases get collapsed by `_hashtag_url` (spaces removed).
        # IG falls back to prefix-match when the concat isn't a real hashtag -
        # noisy but not silent - so we send the run anyway and let enrichment
        # filter. A multi-word phrase that IS a real hashtag (#sociallistening)
        # works as expected.
        hashtag_urls = [_hashtag_url(k) for k in keywords if (k or "").strip()]
        if not hashtag_urls:
            logger.info("[apify/instagram] no usable keywords - skipping")
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

    def _collect_instagram_by_urls(
        self, post_urls: list[str], config: dict,
    ) -> list[Batch]:
        """Direct-fetch IG posts via the post-scraper actor.

        Uses `apify/instagram-scraper` (configurable via
        `apify_actor_instagram_post`) with `directUrls` mode - the keyword
        path's `apidojo/instagram-hashtag-scraper` only accepts hashtag URLs
        and silently returns 0 items for post URLs. Parser is resolved per-call
        from the registry since this is a different actor than the platform
        default at init.
        """
        # Defend against direct callers - front-door parser canonicalises,
        # but the adapter has no guarantee its input came through there.
        # Also dedupe: apify/instagram-scraper rejects the whole run with
        # "directUrls must NOT have duplicate items" if any pair matches.
        seen: set[str] = set()
        canonical: list[str] = []
        for u in post_urls:
            if "instagram.com/" in u and u not in seen:
                seen.add(u)
                canonical.append(u)
        errors = len(post_urls) - len(canonical)

        if not canonical:
            with self._stats_lock:
                self._platform_stats["instagram"] = {
                    "posts": 0, "batches": 0, "errors": errors,
                }
            return []

        settings = get_settings()
        actor_id = settings.apify_actor_instagram_post

        run_input: dict = {
            "directUrls": canonical,
            "resultsType": "posts",
            "resultsLimit": len(canonical),
            "addParentData": False,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }

        raw_items = self._run_actor_collect_raw(
            "instagram", run_input, actor_id=actor_id,
        )

        # Parse with the post-scraper's parser (different schema from the
        # keyword path's apidojo parser stored in self._parsers).
        parse_post, parse_channel = get_parsers("instagram", actor_id)
        posts: list[Post] = []
        channels: dict[str, Channel] = {}
        seen_ids: set[str] = set()
        parse_failures = 0
        for item in raw_items:
            try:
                post = parse_post(item)
            except Exception:  # noqa: BLE001
                parse_failures += 1
                logger.warning("Apify IG direct-fetch parse failure", exc_info=True)
                continue
            if not post.post_id or post.post_id in seen_ids:
                continue
            seen_ids.add(post.post_id)
            posts.append(post)
            try:
                ch = parse_channel(item)
            except Exception:  # noqa: BLE001
                continue
            key = ch.channel_id or ch.channel_handle
            if key and key not in channels:
                channels[key] = ch

        batches = self._chunk_into_batches(posts, list(channels.values()))

        with self._stats_lock:
            self._platform_stats["instagram"] = {
                "posts": len(posts),
                "batches": len(batches),
                "errors": errors,
            }
            self._funnel["apify_raw_records"] += len(raw_items)
            self._funnel["apify_parse_failures"] += parse_failures
            self._funnel["apify_valid_posts"] += len(posts)
        logger.info(
            "[apify/instagram] direct-fetch: %d url(s) → %d raw → %d post(s) in %d batch(es) (actor=%s)",
            len(canonical), len(raw_items), len(posts), len(batches), actor_id,
        )
        return batches

    def _collect_instagram_channels(
        self, channel_urls: list[str], config: dict,
    ) -> list[Batch]:
        """Collect a profile's posts via apify/instagram-scraper (profile mode).

        The keyword actor (apidojo/instagram-hashtag-scraper) only accepts
        hashtag URLs, so channel collection uses the post-scraper actor with the
        profile URLs in `directUrls`. `onlyPostsNewerThan` is a server-side date
        floor (the precise window is still enforced by the pipeline + the parse
        time gate). Keywords, if present, filter the profile's posts client-side
        via `_run_and_parse` → `_maybe_filter_channel_keywords`.
        """
        actor_id = get_settings().apify_actor_instagram_post
        n_posts = config.get("max_posts_per_keyword") or 0
        time_range = config.get("time_range", {}) or {}

        seen: set[str] = set()
        urls: list[str] = []
        for raw in channel_urls:
            u = _normalize_ig_profile_url(raw)
            if u and u not in seen:
                seen.add(u)
                urls.append(u)
        if not urls:
            logger.info("[apify/instagram] channel mode: no usable profile URLs")
            return []

        run_input: dict = {
            "directUrls": urls,
            "resultsType": "posts",
            "addParentData": False,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }
        if n_posts > 0:
            run_input["resultsLimit"] = n_posts * len(urls)
        newer_than = _to_yyyymmdd(time_range.get("start"))
        if newer_than:
            run_input["onlyPostsNewerThan"] = newer_than

        logger.info(
            "[apify/instagram] channel mode: %d profile(s), resultsLimit=%s, newer_than=%s (actor=%s)",
            len(urls), run_input.get("resultsLimit", "unbounded"), newer_than or "(none)", actor_id,
        )
        return self._run_and_parse(
            "instagram", run_input, config, actor_id=actor_id, scrape_kind="channel",
        )

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
    # Facebook - scrapeforge/facebook-search-posts
    #   Schema accepts a single `query` string per run. Fan out one run per
    #   keyword (parallelism capped by the adapter's run budget). Each run
    #   takes precise `start_date` / `end_date` (YYYY-MM-DD).
    # ------------------------------------------------------------------

    def _collect_facebook(self, config: dict) -> Iterator[Batch]:
        channel_urls = config.get("channel_urls", []) or []
        if channel_urls:
            # Channel mode: collect a page/profile's feed via
            # apify/facebook-posts-scraper (startUrls + onlyPostsNewerThan).
            # Keywords, if present, filter the page's posts client-side.
            yield from self._collect_facebook_channels(channel_urls, config)
            return

        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/facebook] no keywords - skipping")
            return

        time_range = config.get("time_range", {}) or {}
        n_posts = config.get("max_posts_per_keyword") or 5

        start_date = _to_yyyymmdd(time_range.get("start"))
        end_date = _to_yyyymmdd(time_range.get("end"))

        # `recent_posts: False` ranks by relevance (FB's algorithm already
        # weights recency as a factor); combined with start_date/end_date this
        # yields "most relevant within window" instead of strict recency.
        # `max_results` is per-query and described as "Maximum unique results"
        # - the actor dedupes server-side, so a 1.5x buffer (capped at the
        # documented hard max of 1000) closes the under-delivery gap.
        per_query_max = min(1000, max(1, math.ceil(n_posts * 1.5))) if n_posts > 0 else n_posts

        # Fan out across keywords; yield batches as each keyword completes
        # so a host crash mid-collection still preserves finished-keyword data.
        # `submit_with_cost_context` propagates the cost-meter contextvar
        # into the pool worker so log_cost inside _run_and_parse attributes
        # to the right user/agent.
        from api.services.cost_meter import submit_with_cost_context

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
                futures.append(
                    submit_with_cost_context(pool, self._run_and_parse, "facebook", run_input, config)
                )
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

    def _collect_facebook_channels(
        self, channel_urls: list[str], config: dict,
    ) -> Iterator[Batch]:
        """Collect a page's or group's posts, routing each URL to the right actor.

        The keyword actor (scrapeforge/facebook-search-posts) takes a `query`
        string and can't target a specific page, so channel collection uses the
        post-scraper actor with the URLs in `startUrls`. Pages/profiles go to
        apify/facebook-posts-scraper; group URLs (facebook.com/groups/...) go to
        apify/facebook-groups-scraper - the page actor returns NO-DATA for group
        feeds. A source can mix both, so we partition and fan out one run per
        bucket. `onlyPostsNewerThan` is a server-side date floor (the precise
        window is still enforced by the pipeline's partition_by_time_range gate +
        the parse time gate). Mirrors the IG channel path (different actor +
        parser than the keyword default).
        """
        settings = get_settings()

        seen: set[str] = set()
        page_urls: list[str] = []
        group_urls: list[str] = []
        for raw in channel_urls:
            u = _normalize_fb_page_url(raw)
            if not u or u in seen:
                continue
            seen.add(u)
            (group_urls if _is_fb_group_url(u) else page_urls).append(u)

        if not page_urls and not group_urls:
            logger.info("[apify/facebook] channel mode: no usable page/group URLs")
            return

        if page_urls:
            yield from self._run_fb_channel_urls(
                page_urls, config,
                actor_id=settings.apify_actor_facebook_page,
                scrape_kind="channel", label="page",
            )
        if group_urls:
            yield from self._run_fb_channel_urls(
                group_urls, config,
                actor_id=settings.apify_actor_facebook_group,
                scrape_kind="group", label="group",
            )

    def _run_fb_channel_urls(
        self, urls: list[str], config: dict, *,
        actor_id: str, scrape_kind: str, label: str,
    ) -> Iterator[Batch]:
        """Run one Facebook channel/group actor over `urls` (page or group feed).

        Page and group actors (apify/facebook-posts-scraper /
        apify/facebook-groups-scraper) share the same startUrls + resultsLimit +
        onlyPostsNewerThan input shape, so this builder serves both. resultsLimit
        is per-bucket (n_posts * len(urls)) to preserve the per-URL budget.
        """
        n_posts = config.get("max_posts_per_keyword") or 0
        time_range = config.get("time_range", {}) or {}

        run_input: dict = {
            "startUrls": [{"url": u} for u in urls],
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }
        if n_posts > 0:
            run_input["resultsLimit"] = n_posts * len(urls)
        newer_than = _to_yyyymmdd(time_range.get("start"))
        if newer_than:
            run_input["onlyPostsNewerThan"] = newer_than

        logger.info(
            "[apify/facebook] %s mode: %d url(s), resultsLimit=%s, newer_than=%s (actor=%s)",
            label, len(urls), run_input.get("resultsLimit", "unbounded"),
            newer_than or "(none)", actor_id,
        )
        yield from self._run_and_parse(
            "facebook", run_input, config, actor_id=actor_id, scrape_kind=scrape_kind,
        )

    # ------------------------------------------------------------------
    # TikTok - clockworks/tiktok-scraper
    #   Hits TikTok's default "Top" search section (engagement-ranked).
    #   We deliberately skip date filtering: the actor's `oldest/newest`
    #   params are silently ignored for `searchQueries` (validated against
    #   chargedEventCounts → `filter-applied: 0`), and the Top section's
    #   high-engagement results span the brand's full history. A client-side
    #   date gate would just discard posts we already paid for.
    # ------------------------------------------------------------------

    def _collect_tiktok(self, config: dict) -> Iterator[Batch]:
        channel_urls = config.get("channel_urls", []) or []
        if channel_urls:
            # Channel mode: clockworks/tiktok-scraper `profiles` input + a
            # server-side `oldestPostDateUnified` floor. Unlike the keyword Top
            # path we DO apply the date gate (the user picked a window). Keywords
            # filter the profile's posts client-side.
            yield from self._collect_tiktok_channels(channel_urls, config)
            return

        keywords = config.get("keywords", []) or []
        if not keywords:
            logger.info("[apify/tiktok] no keywords - skipping")
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
        # Context-propagating submit so log_cost retains attribution
        # through the pool worker boundary.
        from api.services.cost_meter import submit_with_cost_context

        total_parsed = 0
        with ThreadPoolExecutor(max_workers=self._max_parallel) as pool:
            futures = []
            for kw in keywords:
                run_input = {**base_input, "searchQueries": [kw]}
                if n_posts > 0:
                    run_input["resultsPerPage"] = n_posts
                futures.append(
                    submit_with_cost_context(
                        pool,
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

    def _collect_tiktok_channels(
        self, channel_urls: list[str], config: dict,
    ) -> Iterator[Batch]:
        """Collect TikTok profiles via clockworks/tiktok-scraper `profiles` mode
        (same actor + parser as the keyword Top path, different input)."""
        n_posts = config.get("max_posts_per_keyword") or 0
        time_range = config.get("time_range", {}) or {}

        profiles = [p for p in (_normalize_tiktok_profile(u) for u in channel_urls) if p]
        if not profiles:
            logger.info("[apify/tiktok] channel mode: no usable profile handles")
            return

        run_input: dict = {
            "profiles": profiles,
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
        oldest = _to_yyyymmdd(time_range.get("start"))
        if oldest:
            run_input["oldestPostDateUnified"] = oldest

        logger.info(
            "[apify/tiktok] channel mode: %d profile(s), resultsPerPage=%s, oldest=%s",
            len(profiles), n_posts or "unbounded", oldest or "(none)",
        )
        yield from self._run_and_parse(
            "tiktok", run_input, config, apply_time_gate=True, scrape_kind="channel",
        )

    # ------------------------------------------------------------------
    # Shared run + parse + gate
    # ------------------------------------------------------------------

    def _run_actor_collect_raw(
        self,
        platform: str,
        run_input: dict,
        *,
        feature: str = "scrape",
        actor_id: str | None = None,
        scrape_kind: str | None = None,
    ) -> list[dict]:
        """Trigger one actor run and return raw dataset items. Empty on failure.

        Centralizes run-budget claim, error capture, timing, and raw-record
        funnel accounting. Callers do their own parsing - IG uses this directly
        because it merges items from two passes before parsing once.

        `feature` controls the cost-log tag (e.g. "scrape" for collection,
        "comments" for per-post comment fetches). `actor_id`, when set,
        overrides the per-platform default actor - used by the comments
        path to invoke a different actor than the collection actor.
        `scrape_kind="channel"` tags channel-mode runs so Finance breaks them
        out and the estimate fallback uses the channel rate cell (Apify live
        cost is provider-reported either way).
        """
        if not self._claim_run():
            return []

        actor_id = actor_id or self._actor_ids[platform]
        started = time.monotonic()
        # Cap total in-flight actor calls across all platforms - see __init__.
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

        # Cost telemetry - Apify exposes the total USD on the run object as
        # `usageTotalUsd` (top-level). Older SDK shapes used `run.usage.cost`
        # or `run.usage.totalUsageUsd`; try in order so we capture whichever
        # the runtime returned. When Apify reports nothing we fall back to
        # ``apify_assumed_per_post_usd`` × records collected, tagged with
        # ``cost_source="estimated_fallback"`` so the admin UI surfaces the
        # difference between a provider-reported charge and our estimate.
        try:
            from api.services.cost_meter import (
                COST_SOURCE_ESTIMATED_FALLBACK,
                COST_SOURCE_PROVIDER_REPORTED,
                EVENT_PROVIDER,
                log_cost,
            )

            usage = run.get("usage") or {}
            reported = (
                run.get("usageTotalUsd")          # current Apify API
                or usage.get("totalUsageUsd")     # legacy SDK shape
                or usage.get("cost")              # ancient SDK shape
            )
            payload = {
                "actor_id": actor_id,
                "run_id": run.get("id"),
                "platform": platform,
                "dataset_id": dataset_id,
                "usage": usage,
                "usageTotalUsd": run.get("usageTotalUsd"),
            }
            if reported is not None:
                log_cost(
                    provider="apify",
                    user_id="",  # filled from collection_context if bound
                    feature=feature,
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    platform=platform,
                    units=len(raw_items),
                    unit_kind="records",
                    provider_reported_cost_usd=float(reported),
                    cost_source=COST_SOURCE_PROVIDER_REPORTED,
                    raw_provider_payload=payload,
                    scrape_kind=scrape_kind,
                )
            else:
                # Provider went silent - estimate from the admin-configured
                # assumed per-post knob so the row still shows up under the
                # right agent (`cost_source` makes the estimate explicit).
                from config.cost_rates import get_apify_assumed_per_post_usd

                # Per-platform fallback rate (admin-tunable): IG vs FB vs
                # TikTok each have a distinct effective per-call price.
                assumed = get_apify_assumed_per_post_usd(platform, scrape_kind or "posts")
                estimated_usd = max(0.0, float(assumed) * len(raw_items))
                logger.warning(
                    "Apify run %s returned no cost (run.usageTotalUsd=%s, "
                    "run.usage=%s) - logging estimated_fallback at $%.6f "
                    "($%s/post × %d posts)",
                    run.get("id"), run.get("usageTotalUsd"), usage,
                    estimated_usd, assumed, len(raw_items),
                )
                payload["estimated"] = {
                    "assumed_per_post_usd": float(assumed),
                    "records": len(raw_items),
                }
                log_cost(
                    provider="apify",
                    user_id="",
                    feature=feature,
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    platform=platform,
                    units=len(raw_items),
                    unit_kind="records",
                    provider_reported_cost_usd=estimated_usd,
                    cost_source=COST_SOURCE_ESTIMATED_FALLBACK,
                    raw_provider_payload=payload,
                    scrape_kind=scrape_kind,
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
        actor_id: str | None = None,
        scrape_kind: str | None = None,
    ) -> list[Batch]:
        """Trigger one actor run, iterate the dataset, parse, time-gate, batch."""
        raw_items = self._run_actor_collect_raw(
            platform, run_input, actor_id=actor_id, scrape_kind=scrape_kind,
        )
        return self._parse_results(
            platform, raw_items, config, apply_time_gate=apply_time_gate,
            actor_id=actor_id,
        )

    def _parse_results(
        self,
        platform: str,
        raw_items: list[dict],
        config: dict,
        *,
        apply_time_gate: bool = True,
        actor_id: str | None = None,
    ) -> list[Batch]:
        if not raw_items:
            return []

        # `actor_id` lets a channel/profile path parse with a DIFFERENT actor's
        # parser than the platform's default keyword actor (e.g. IG profile uses
        # apify/instagram-scraper, not the apidojo hashtag scraper).
        if actor_id:
            parse_post, parse_channel = get_parsers(platform, actor_id)
        else:
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

            # Client-side time gate - server-side filters are coarse for TikTok
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
    # Engagement refresh - one batched run per platform via directUrls.
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

    # Per-platform comments config - each Apify actor accepts a different
    # set of input field names + URL payload shape, so we carry the URL
    # key + limit key + URL wrapper here alongside the parsers.
    #
    # Fields: (
    #   actor_id_settings_attr,
    #   results_limit_settings_attr,
    #   url_input_key,        # actor input field that takes the list of post URLs
    #   limit_input_key,      # actor input field that takes the per-post cap
    #   flatten_fn,
    #   author_parse_fn,
    #   url_payload_fn,       # build the value passed under url_input_key
    # )
    _COMMENTS_CONFIG = {
        "instagram": (
            "apify_actor_instagram_comments",
            "apify_instagram_comments_max",
            "directUrls",
            "resultsLimit",
            flatten_apify_instagram_comments,
            parse_apify_instagram_comment_author,
            lambda url: [url],
        ),
        "tiktok": (
            "apify_actor_tiktok_comments",
            "apify_tiktok_comments_max",
            "postURLs",
            "commentsPerPost",
            flatten_apify_tiktok_comments,
            parse_apify_tiktok_comment_author,
            lambda url: [url],
        ),
        "youtube": (
            "apify_actor_youtube_comments",
            "apify_youtube_comments_max",
            "startUrls",
            "maxComments",
            flatten_apify_youtube_comments,
            parse_apify_youtube_comment_author,
            lambda url: [{"url": url}],
        ),
        "facebook": (
            "apify_actor_facebook_comments",
            "apify_facebook_comments_max",
            "startUrls",
            "resultsLimit",
            flatten_apify_facebook_comments,
            parse_apify_facebook_comment_author,
            lambda url: [{"url": url}],
        ),
    }

    def fetch_comments(self, post: dict) -> CommentBatch:
        """Fetch comments for a single post via a per-platform Apify actor.

        Mirrors XAPIAdapter.fetch_comments shape (sync request/response,
        return CommentBatch). Top-level items from the actor become root
        Comments; nested `replies` are flattened and linked via
        `replied_to_id` so `resolve_comment_roots` builds the thread tree
        the UI already renders.

        Cost is tagged feature="comments" sub_kind=platform via
        `_run_actor_collect_raw`'s provider-reported pathway.
        """
        platform = post.get("platform")
        config = self._COMMENTS_CONFIG.get(platform)
        if config is None:
            raise NotImplementedError(
                f"fetch_comments not supported by ApifyAdapter on {platform!r} - "
                f"supported: {sorted(self._COMMENTS_CONFIG)}"
            )
        (
            actor_attr,
            limit_attr,
            url_input_key,
            limit_input_key,
            flatten_fn,
            parse_author_fn,
            url_payload_fn,
        ) = config

        post_url = post.get("post_url")
        post_id = post.get("post_id") or ""
        if not post_url:
            logger.warning("Apify %s comments: missing post_url on payload %s", platform, post)
            return CommentBatch()

        settings = get_settings()
        results_limit = max(1, int(getattr(settings, limit_attr)))
        actor_id = getattr(settings, actor_attr)

        run_input: dict = {
            url_input_key: url_payload_fn(post_url),
            limit_input_key: results_limit,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": [self._proxy_group],
            },
        }

        raw_items = self._run_actor_collect_raw(
            platform,
            run_input,
            feature="comments",
            actor_id=actor_id,
        )

        comments = flatten_fn(raw_items, post_id=post_id)

        channels_by_id: dict[str, Channel] = {}
        for item in raw_items:
            ch = parse_author_fn(item)
            key = ch.channel_id or ch.channel_handle
            if key and key not in channels_by_id:
                channels_by_id[key] = ch
            replies = item.get("replies") or []
            if isinstance(replies, list):
                for reply in replies:
                    if not isinstance(reply, dict):
                        continue
                    rch = parse_author_fn(reply)
                    rkey = rch.channel_id or rch.channel_handle
                    if rkey and rkey not in channels_by_id:
                        channels_by_id[rkey] = rch

        resolve_comment_roots(comments, post_id=post_id)

        for c in comments:
            c.crawl_provider = "apify"

        logger.info(
            "Apify %s: fetched %d comments + %d authors for post %s",
            platform, len(comments), len(channels_by_id), post_id,
        )
        return CommentBatch(comments=comments, channels=list(channels_by_id.values()))

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

        # Cost telemetry for engagement-refresh runs (same provider-reported
        # pattern). See `_run_actor_collect_raw` for the key-path rationale.
        # Engagement refresh is far less common than the initial crawl, so a
        # missing-cost row is more visible - keep the fallback symmetric.
        try:
            from api.services.cost_meter import (
                COST_SOURCE_ESTIMATED_FALLBACK,
                COST_SOURCE_PROVIDER_REPORTED,
                EVENT_PROVIDER,
                log_cost,
            )

            usage = run.get("usage") or {}
            reported = (
                run.get("usageTotalUsd")
                or usage.get("totalUsageUsd")
                or usage.get("cost")
            )
            if reported is not None:
                log_cost(
                    provider="apify",
                    user_id="",
                    feature="scrape_engagement",
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    platform=platform,
                    units=len(urls),
                    unit_kind="records",
                    provider_reported_cost_usd=float(reported),
                    cost_source=COST_SOURCE_PROVIDER_REPORTED,
                )
            else:
                from config.cost_rates import get_apify_assumed_per_post_usd

                # Per-platform fallback rate (admin-tunable): IG vs FB vs
                # TikTok each have a distinct effective per-call price.
                assumed = get_apify_assumed_per_post_usd(platform)
                estimated_usd = max(0.0, float(assumed) * len(urls))
                logger.warning(
                    "Apify engagement-refresh run %s returned no cost - "
                    "logging estimated_fallback at $%.6f",
                    run.get("id"), estimated_usd,
                )
                log_cost(
                    provider="apify",
                    user_id="",
                    feature="scrape_engagement",
                    event_type=EVENT_PROVIDER,
                    sub_kind=platform,
                    platform=platform,
                    units=len(urls),
                    unit_kind="records",
                    provider_reported_cost_usd=estimated_usd,
                    cost_source=COST_SOURCE_ESTIMATED_FALLBACK,
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
