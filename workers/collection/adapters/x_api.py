"""X (Twitter) API v2 adapter.

Default vendor for the `twitter` platform. Uses OAuth 2.0 App-Only Bearer
Token against the official X API. PAYG-tier-friendly:
- Only the `/2/tweets/search/recent` endpoint (last 7 days) is used.
- Pagination capped per `max_calls` to bound read costs.
- Engagement refresh batches IDs in groups of 100 via `/2/tweets?ids=`.

Keyword search and user-timeline tasks fan out via ThreadPoolExecutor with
per-task error isolation (mirrors VetricAdapter._collect_twitter).
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import requests

from config.settings import get_settings
from workers.collection.adapters._budget import derive_pagination
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.x_api_client import XAPIClient, XAPIError
from workers.collection.adapters.x_api_parsers import (
    extract_twitter_id,
    extract_twitter_username,
    parse_x_channel,
    parse_x_post,
)
from workers.collection.models import Batch, Channel, Post

logger = logging.getLogger(__name__)

_MAX_WORKERS = 4  # PAYG is read-priced; modest parallelism is enough.
_RECENT_SEARCH_MAX_DAYS = 7
_TWEETS_LOOKUP_BATCH_SIZE = 100  # /2/tweets?ids= hard cap
_PAGE_SIZE_MIN = 10  # X API /search/recent requires max_results >= 10
_PAGE_SIZE_MAX = 100  # X API /search/recent max_results upper bound
_VALID_SORT_ORDERS = {"recency", "relevancy"}


class XAPIAdapter(DataProviderAdapter):
    """Adapter for the official X API v2."""

    SUPPORTED = ["twitter"]
    DEFAULT_TWEET_FIELDS = (
        "created_at,lang,public_metrics,entities,referenced_tweets,"
        "conversation_id,attachments,context_annotations,possibly_sensitive,"
        "author_id"
    )
    DEFAULT_USER_FIELDS = (
        "username,verified,public_metrics,profile_image_url,description,"
        "created_at,location"
    )
    DEFAULT_MEDIA_FIELDS = (
        "url,preview_image_url,type,duration_ms,width,height,variants"
    )
    DEFAULT_EXPANSIONS = "attachments.media_keys,author_id,referenced_tweets.id"

    def __init__(self):
        settings = get_settings()
        token = settings.x_api_bearer_token
        if not token:
            raise ValueError("X_API_BEARER_TOKEN not configured")
        self._client = XAPIClient(
            bearer_token=token,
            min_request_interval_sec=settings.x_api_min_request_interval_sec,
        )
        self._max_results = max(_PAGE_SIZE_MIN, min(_PAGE_SIZE_MAX, settings.x_api_max_results))
        self._default_sort_order = _normalize_sort_order(settings.x_api_sort_order)
        self._fallback_max_calls = max(1, settings.x_api_default_max_calls)
        self._platform_stats: dict[str, dict] = {}
        self._stats_lock = threading.Lock()
        logger.info(
            "XAPIAdapter initialized (max_results=%d, sort_order=%s, min_interval=%.2fs)",
            self._max_results, self._default_sort_order,
            settings.x_api_min_request_interval_sec,
        )

    def supported_platforms(self) -> list[str]:
        return list(self.SUPPORTED)

    @property
    def platform_stats(self) -> dict[str, dict]:
        return dict(self._platform_stats)

    # ------------------------------------------------------------------
    # Collection
    # ------------------------------------------------------------------

    def collect(self, config: dict) -> list[Batch]:
        self._platform_stats = {}
        if "twitter" not in config.get("platforms", []):
            return []

        keywords = config.get("keywords", []) or []
        channel_urls = config.get("channel_urls", []) or []
        min_likes = config.get("min_likes")
        sort_order = _normalize_sort_order(config.get("sort_order")) or self._default_sort_order
        start_time, end_time = _clamp_to_recent_window(
            config.get("time_range") or {}, max_days=_RECENT_SEARCH_MAX_DAYS,
        )

        # Per-task post budget. collection_service derives this from
        # n_posts / (platforms * keywords). When set, it directly drives
        # how many requests we make — every post is a billable read on PAYG.
        per_task_budget = config.get("max_posts_per_keyword")
        page_size, max_calls, hard_cap = derive_pagination(
            per_task_budget,
            page_max=self._max_results,
            page_min=_PAGE_SIZE_MIN,
            fallback_calls=self._fallback_max_calls,
        )

        tasks: list[tuple[str, str]] = []
        for kw in keywords:
            tasks.append(("search", kw))
        for url in channel_urls:
            uname = extract_twitter_username(url)
            if uname:
                tasks.append(("user_timeline", uname))

        if not tasks:
            with self._stats_lock:
                self._platform_stats["twitter"] = {"posts": 0, "batches": 0, "errors": 0}
            return []

        logger.info(
            "X API collect: %d tasks, page_size=%d, max_calls=%d, hard_cap=%s, sort=%s",
            len(tasks), page_size, max_calls,
            hard_cap if hard_cap is not None else "unbounded", sort_order,
        )

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(tasks), _MAX_WORKERS)) as pool:
            futures = {
                pool.submit(
                    self._run_task, task_type, target,
                    page_size, max_calls, hard_cap,
                    start_time, end_time, min_likes, sort_order,
                ): (task_type, target)
                for task_type, target in tasks
            }
            errors = 0
            for future in as_completed(futures):
                task_type, target = futures[future]
                try:
                    all_batches.extend(future.result())
                except (XAPIError, requests.RequestException) as e:
                    logger.warning(
                        "X API %s failed for '%s': %s", task_type, target, e,
                    )
                    errors += 1
                except Exception:
                    logger.exception(
                        "X API %s unexpected error for '%s'", task_type, target,
                    )
                    errors += 1

        post_count = sum(len(b.posts) for b in all_batches)
        with self._stats_lock:
            self._platform_stats["twitter"] = {
                "posts": post_count,
                "batches": len(all_batches),
                "errors": errors,
            }
        logger.info(
            "X API: collected %d posts in %d batches (%d task errors)",
            post_count, len(all_batches), errors,
        )
        return all_batches

    def _run_task(
        self,
        task_type: str,
        target: str,
        page_size: int,
        max_calls: int,
        hard_cap: int | None,
        start_time: str,
        end_time: str,
        min_likes: int | None,
        sort_order: str,
    ) -> list[Batch]:
        if task_type == "search":
            return self._search_recent(
                keyword=target, page_size=page_size, max_calls=max_calls,
                hard_cap=hard_cap, start_time=start_time, end_time=end_time,
                min_likes=min_likes, sort_order=sort_order,
            )
        return self._user_timeline(
            username=target, page_size=page_size, max_calls=max_calls,
            hard_cap=hard_cap,
        )

    # ------------------------------------------------------------------
    # /2/tweets/search/recent
    # ------------------------------------------------------------------

    def _search_recent(
        self,
        keyword: str,
        page_size: int,
        max_calls: int,
        hard_cap: int | None,
        start_time: str,
        end_time: str,
        min_likes: int | None,
        sort_order: str,
    ) -> list[Batch]:
        query = self._build_search_query(keyword, min_likes)
        params: dict = {
            "query": query,
            "max_results": page_size,
            "start_time": start_time,
            "end_time": end_time,
            "sort_order": sort_order,
            "tweet.fields": self.DEFAULT_TWEET_FIELDS,
            "user.fields": self.DEFAULT_USER_FIELDS,
            "media.fields": self.DEFAULT_MEDIA_FIELDS,
            "expansions": self.DEFAULT_EXPANSIONS,
        }
        return self._paginate(
            path="tweets/search/recent",
            params=params,
            max_calls=max_calls,
            hard_cap=hard_cap,
            search_keyword=keyword,
        )

    @staticmethod
    def _build_search_query(keyword: str, min_likes: int | None) -> str:
        # Default to excluding retweets so we get original posts (retweets
        # are reachable via referenced_tweets if needed). Optional min_faves
        # operator is supported on /search/recent for all paid tiers.
        parts = [keyword.strip(), "-is:retweet"]
        if isinstance(min_likes, int) and min_likes > 0:
            parts.append(f"min_faves:{min_likes}")
        return " ".join(parts)

    # ------------------------------------------------------------------
    # /2/users/by/username/:u + /2/users/:id/tweets
    # ------------------------------------------------------------------

    def _user_timeline(
        self,
        username: str,
        page_size: int,
        max_calls: int,
        hard_cap: int | None,
    ) -> list[Batch]:
        user = self._resolve_user(username)
        if not user:
            return []
        user_id = user.get("id")
        if not user_id:
            return []

        # /users/:id/tweets requires max_results in [5, 100] (different floor
        # than /search/recent's [10, 100]). Clamp accordingly.
        timeline_page_size = max(5, min(100, page_size))
        params: dict = {
            "max_results": timeline_page_size,
            "exclude": "retweets",
            "tweet.fields": self.DEFAULT_TWEET_FIELDS,
            "user.fields": self.DEFAULT_USER_FIELDS,
            "media.fields": self.DEFAULT_MEDIA_FIELDS,
            "expansions": self.DEFAULT_EXPANSIONS,
        }
        return self._paginate(
            path=f"users/{user_id}/tweets",
            params=params,
            max_calls=max_calls,
            hard_cap=hard_cap,
            search_keyword=None,
            seed_channel=parse_x_channel(user),
        )

    def _resolve_user(self, username: str) -> dict | None:
        try:
            resp = self._client.get(
                f"users/by/username/{username}",
                params={"user.fields": self.DEFAULT_USER_FIELDS},
            )
        except XAPIError as e:
            logger.warning("X API resolve user '%s' failed: %s", username, e)
            return None
        return resp.get("data")

    # ------------------------------------------------------------------
    # Shared pagination loop
    # ------------------------------------------------------------------

    def _paginate(
        self,
        path: str,
        params: dict,
        max_calls: int,
        hard_cap: int | None,
        search_keyword: str | None,
        seed_channel: Channel | None = None,
    ) -> list[Batch]:
        batches: list[Batch] = []
        next_token: str | None = None
        seeded_channel = False
        running_total = 0

        for _ in range(max(1, max_calls)):
            page_params = dict(params)
            if next_token:
                page_params["pagination_token"] = next_token

            resp = self._client.get(path, params=page_params)
            tweets = resp.get("data") or []
            if not tweets:
                break
            includes = resp.get("includes") or {}

            posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for tweet in tweets:
                posts.append(parse_x_post(tweet, includes))

            # Truncate this page when it would push us past the hard cap.
            # Page size is sized per-task so this only fires on the last page
            # when budget < page_min (e.g. budget=5 but X requires page>=10).
            if hard_cap is not None:
                remaining = hard_cap - running_total
                if remaining <= 0:
                    break
                if len(posts) > remaining:
                    posts = posts[:remaining]

            for user in includes.get("users") or []:
                ch = parse_x_channel(user)
                if ch.channel_handle and ch.channel_handle not in channels_seen:
                    channels_seen[ch.channel_handle] = ch

            if seed_channel and not seeded_channel:
                if seed_channel.channel_handle not in channels_seen:
                    channels_seen[seed_channel.channel_handle] = seed_channel
                seeded_channel = True

            if posts:
                self._stamp_posts(posts, search_keyword)
                batches.append(
                    Batch(posts=posts, channels=list(channels_seen.values())),
                )
                running_total += len(posts)

            if hard_cap is not None and running_total >= hard_cap:
                break

            next_token = (resp.get("meta") or {}).get("next_token")
            if not next_token:
                break

        return batches

    @staticmethod
    def _stamp_posts(posts: list[Post], keyword: str | None) -> None:
        for post in posts:
            post.crawl_provider = "xapi"
            post.search_keyword = keyword

    # ------------------------------------------------------------------
    # Engagement refresh — /2/tweets?ids=
    # ------------------------------------------------------------------

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        if not post_urls:
            return []
        url_by_id: dict[str, str] = {}
        for url in post_urls:
            tid = extract_twitter_id(url)
            if tid:
                url_by_id[tid] = url
            else:
                logger.warning("X API: cannot extract tweet id from %s", url)
        if not url_by_id:
            return []

        results: list[dict] = []
        ids = list(url_by_id.keys())
        for chunk_start in range(0, len(ids), _TWEETS_LOOKUP_BATCH_SIZE):
            chunk = ids[chunk_start:chunk_start + _TWEETS_LOOKUP_BATCH_SIZE]
            params = {
                "ids": ",".join(chunk),
                "tweet.fields": "public_metrics",
            }
            try:
                resp = self._client.get("tweets", params=params)
            except (XAPIError, requests.RequestException) as e:
                logger.warning("X API engagement refresh failed for %d ids: %s", len(chunk), e)
                continue
            for tweet in resp.get("data") or []:
                tid = str(tweet.get("id", ""))
                metrics = tweet.get("public_metrics") or {}
                original_url = url_by_id.get(tid)
                if not original_url:
                    continue
                results.append({
                    "post_url": original_url,
                    "likes": metrics.get("like_count"),
                    "shares": metrics.get("retweet_count"),
                    "comments_count": metrics.get("reply_count"),
                    "views": metrics.get("impression_count"),
                    "saves": metrics.get("bookmark_count"),
                    "comments": [],
                })
        return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clamp_to_recent_window(time_range: dict, max_days: int) -> tuple[str, str]:
    """Convert collection_service's {start, end} dict to RFC 3339 strings.

    `/tweets/search/recent` only goes back 7 days. If the requested window
    is older or empty, snap start to (now - max_days). end defaults to now.
    Always emits the 'Z' UTC suffix that X API expects.
    """
    now = datetime.now(timezone.utc)
    earliest = now - timedelta(days=max_days)

    start = _parse_date_loose(time_range.get("start"))
    end = _parse_date_loose(time_range.get("end"))

    if start is None or start < earliest:
        start = earliest
    if end is None or end > now:
        end = now
    if end <= start:
        end = now

    # X API requires end_time at least 10 seconds before "now". Clamp to
    # avoid HTTP 400 "end_time must be a minimum of 10 seconds prior".
    end = min(end, now - timedelta(seconds=10))
    if end <= start:
        end = start + timedelta(seconds=1)

    return _to_rfc3339(start), _to_rfc3339(end)


def _parse_date_loose(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        s = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            try:
                dt = datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _to_rfc3339(dt: datetime) -> str:
    """X API accepts 'YYYY-MM-DDTHH:MM:SSZ' (no fractional seconds needed)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_sort_order(value) -> str | None:
    """Validate against X API's `sort_order` enum. Returns None for unknown."""
    if not value:
        return None
    v = str(value).strip().lower()
    return v if v in _VALID_SORT_ORDERS else None
