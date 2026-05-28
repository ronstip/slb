"""X (Twitter) API v2 adapter.

Default vendor for the `twitter` platform. Uses OAuth 2.0 App-Only Bearer
Token against the official X API. Uses `/2/tweets/search/all` for full-archive
keyword search (back to 2006-03-21). Pagination is capped per `max_calls` to
bound read costs. Engagement refresh batches IDs in groups of 100 via
`/2/tweets?ids=`.

Keyword search and user-timeline tasks fan out via ThreadPoolExecutor with
per-task error isolation (mirrors VetricAdapter._collect_twitter).
"""

import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import requests

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.x_api_client import XAPIClient, XAPIError
from workers.collection.adapters.x_api_parsers import (
    _index_tweets_by_id as _index_includes_tweets,
    _index_users_by_id,
    extract_twitter_id,
    extract_twitter_username,
    parse_comment,
    parse_comment_author,
    parse_x_channel,
    parse_x_post,
    resolve_comment_roots,
)
from workers.collection.models import Batch, Channel, Comment, CommentBatch, Post

logger = logging.getLogger(__name__)

_MAX_WORKERS = 4  # PAYG is read-priced; modest parallelism is enough.
_DEFAULT_FALLBACK_DAYS = 30  # used only if caller omits time_range (defensive)
_TWEETS_LOOKUP_BATCH_SIZE = 100  # /2/tweets?ids= hard cap
_PAGE_SIZE_MIN = 10  # X API /search/all requires max_results >= 10
_PAGE_SIZE_MAX = 500  # X API /search/all max_results upper bound
_VALID_SORT_ORDERS = {"recency", "relevancy"}
_VALID_HAS_MEDIA = {"with", "without", "any"}
_DEFAULT_HAS_MEDIA = "any"


class XAPIAdapter(DataProviderAdapter):
    """Adapter for the official X API v2."""

    SUPPORTED = ["twitter"]
    # `note_tweet` carries the long-form (>280 char) body for Premium-authored
    # posts — supersedes the truncated `text` field when present. Same field
    # is honored on referenced tweets (quoted/replied) hydrated via includes.
    DEFAULT_TWEET_FIELDS = (
        "created_at,lang,public_metrics,entities,referenced_tweets,"
        "conversation_id,attachments,context_annotations,possibly_sensitive,"
        "author_id,note_tweet"
    )
    DEFAULT_USER_FIELDS = (
        "username,verified,public_metrics,profile_image_url,description,"
        "created_at,location"
    )
    DEFAULT_MEDIA_FIELDS = (
        "url,preview_image_url,type,duration_ms,width,height,variants"
    )
    # `referenced_tweets.id.author_id` and `.attachments.media_keys` hydrate the
    # quoted/replied tweets' authors and media in `includes.users`/`includes.media`,
    # so unpacked dep Posts get the same field coverage as parents.
    DEFAULT_EXPANSIONS = (
        "attachments.media_keys,author_id,referenced_tweets.id,"
        "referenced_tweets.id.author_id,referenced_tweets.id.attachments.media_keys"
    )

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
        self._unpack_referenced = bool(settings.x_api_unpack_referenced_posts)
        self._platform_stats: dict[str, dict] = {}
        self._referenced_post_count = 0
        self._stats_lock = threading.Lock()
        logger.info(
            "XAPIAdapter initialized (max_results=%d, sort_order=%s, min_interval=%.2fs, unpack_refs=%s)",
            self._max_results, self._default_sort_order,
            settings.x_api_min_request_interval_sec, self._unpack_referenced,
        )

    def supported_platforms(self) -> list[str]:
        return list(self.SUPPORTED)

    def supported_comment_platforms(self) -> list[str]:
        return ["twitter"]

    @property
    def platform_stats(self) -> dict[str, dict]:
        return dict(self._platform_stats)

    # ------------------------------------------------------------------
    # Collection
    # ------------------------------------------------------------------

    def collect(self, config: dict) -> list[Batch]:
        self._platform_stats = {}
        self._referenced_post_count = 0  # transient, per-collect
        if "twitter" not in config.get("platforms", []):
            return []

        keywords = config.get("keywords", []) or []
        channel_urls = config.get("channel_urls", []) or []
        has_media = _normalize_has_media(config.get("has_media"))
        sort_order = _normalize_sort_order(config.get("sort_order")) or self._default_sort_order
        end_lag_hours = float(
            config.get("end_time_lag_hours")
            or get_settings().x_api_end_time_lag_hours
        )
        start_time, end_time = _resolve_time_window(
            config.get("time_range") or {},
            end_lag_seconds=int(end_lag_hours * 3600),
        )

        # Per-task post budget from collection_service (n_posts / platforms / keywords).
        # Always request a full page so X's relevance ranking has density to work
        # with; truncate to budget after parsing in `_paginate`.
        per_task_budget = config.get("max_posts_per_keyword") or 0
        page_size = self._max_results
        if per_task_budget > 0:
            max_calls = max(1, math.ceil(per_task_budget / page_size))
            hard_cap = per_task_budget
        else:
            max_calls = self._fallback_max_calls
            hard_cap = None

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
            "X API collect: %d tasks, page_size=%d, max_calls=%d, hard_cap=%s, sort=%s, has_media=%s, end_lag_hours=%.2f",
            len(tasks), page_size, max_calls,
            hard_cap if hard_cap is not None else "unbounded",
            sort_order, has_media, end_lag_hours,
        )

        all_batches: list[Batch] = []
        with ThreadPoolExecutor(max_workers=min(len(tasks), _MAX_WORKERS)) as pool:
            futures = {
                pool.submit(
                    self._run_task, task_type, target,
                    page_size, max_calls, hard_cap,
                    start_time, end_time, has_media, sort_order,
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
            primary_count = max(0, post_count - self._referenced_post_count)
            self._platform_stats["twitter"] = {
                "posts": post_count,
                "primary_posts": primary_count,
                "referenced_posts": self._referenced_post_count,
                "batches": len(all_batches),
                "errors": errors,
            }
        logger.info(
            "X API: collected %d posts (%d primary + %d referenced) in %d batches (%d task errors)",
            post_count, primary_count, self._referenced_post_count, len(all_batches), errors,
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
        has_media: str,
        sort_order: str,
    ) -> list[Batch]:
        if task_type == "search":
            return self._search_recent(
                keyword=target, page_size=page_size, max_calls=max_calls,
                hard_cap=hard_cap, start_time=start_time, end_time=end_time,
                has_media=has_media, sort_order=sort_order,
            )
        return self._user_timeline(
            username=target, page_size=page_size, max_calls=max_calls,
            hard_cap=hard_cap, start_time=start_time, end_time=end_time,
        )

    # ------------------------------------------------------------------
    # /2/tweets/search/all
    # ------------------------------------------------------------------

    def _search_recent(
        self,
        keyword: str,
        page_size: int,
        max_calls: int,
        hard_cap: int | None,
        start_time: str,
        end_time: str,
        has_media: str,
        sort_order: str,
    ) -> list[Batch]:
        query = self._build_search_query(keyword, has_media)
        # X API requires max_results <= 100 when context_annotations is requested.
        if "context_annotations" in self.DEFAULT_TWEET_FIELDS:
            page_size = min(page_size, 100)
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
            path="tweets/search/all",
            params=params,
            max_calls=max_calls,
            hard_cap=hard_cap,
            search_keyword=keyword,
        )

    @staticmethod
    def _build_search_query(keyword: str, has_media: str) -> str:
        return f"{keyword.strip()} -is:retweet"

    # ------------------------------------------------------------------
    # /2/users/by/username/:u + /2/users/:id/tweets
    # ------------------------------------------------------------------

    def _user_timeline(
        self,
        username: str,
        page_size: int,
        max_calls: int,
        hard_cap: int | None,
        start_time: str,
        end_time: str,
    ) -> list[Batch]:
        user = self._resolve_user(username)
        if not user:
            return []
        user_id = user.get("id")
        if not user_id:
            return []

        # /users/:id/tweets requires max_results in [5, 100] (tighter ceiling
        # than /search/all's [10, 500]). Clamp accordingly.
        timeline_page_size = max(5, min(100, page_size))
        params: dict = {
            "max_results": timeline_page_size,
            "start_time": start_time,
            "end_time": end_time,
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

            primary_posts: list[Post] = []
            channels_seen: dict[str, Channel] = {}
            for tweet in tweets:
                primary_posts.append(parse_x_post(tweet, includes))

            # Truncate this page when it would push us past the hard cap.
            # Page size is sized per-task so this only fires on the last page
            # when budget < page_min (e.g. budget=5 but X requires page>=10).
            # hard_cap counts only PRIMARY posts; referenced unpacks are bonus.
            if hard_cap is not None:
                remaining = hard_cap - running_total
                if remaining <= 0:
                    break
                if len(primary_posts) > remaining:
                    primary_posts = primary_posts[:remaining]

            referenced_posts: list[Post] = []
            if self._unpack_referenced:
                referenced_posts = self._unpack_referenced_posts(
                    primary_posts, tweets, includes,
                )

            for user in includes.get("users") or []:
                ch = parse_x_channel(user)
                if ch.channel_handle and ch.channel_handle not in channels_seen:
                    channels_seen[ch.channel_handle] = ch

            if seed_channel and not seeded_channel:
                if seed_channel.channel_handle not in channels_seen:
                    channels_seen[seed_channel.channel_handle] = seed_channel
                seeded_channel = True

            posts = primary_posts + referenced_posts
            if posts:
                self._stamp_posts(posts, search_keyword)
                batches.append(
                    Batch(posts=posts, channels=list(channels_seen.values())),
                )
                # hard_cap budget tracks primary only.
                running_total += len(primary_posts)
                if referenced_posts:
                    with self._stats_lock:
                        self._referenced_post_count += len(referenced_posts)

            if hard_cap is not None and running_total >= hard_cap:
                break

            next_token = (resp.get("meta") or {}).get("next_token")
            if not next_token:
                break

        return batches

    def _unpack_referenced_posts(
        self,
        primary_posts: list[Post],
        tweets: list[dict],
        includes: dict,
    ) -> list[Post]:
        """Promote each unique quoted/replied source tweet into its own Post.

        Walks `referenced_tweets[]` on each primary tweet (matched by index to
        `primary_posts`), collects quoted/replied refs that are hydrated in
        `includes.tweets`, deduplicates by id within this page, and parses each
        into a Post that travels in the same Batch.

        Side effect: stamps `enrichment_dependency_post_id` and
        `enrichment_dependency_type` onto the matching primary Post so PR #2's
        pipeline gate knows to wait for the dep's media before enriching.

        Skipped:
        - retweeted refs (we exclude RTs at query level; if present, source
          content == original — no extra context value)
        - refs not hydrated in includes.tweets (deleted/protected/missing)
        - refs whose ID matches a primary post already in this page (dep was
          itself directly collected — no need to duplicate)
        """
        primary_ids = {p.post_id for p in primary_posts}
        primary_post_by_index = {i: p for i, p in enumerate(primary_posts)}
        tweets_by_id = _index_includes_tweets(includes)
        if not tweets_by_id:
            return []

        unpacked: dict[str, Post] = {}
        for idx, tweet in enumerate(tweets):
            primary_post = primary_post_by_index.get(idx)
            if primary_post is None:
                continue  # truncated by hard_cap above
            for ref in tweet.get("referenced_tweets") or []:
                ref_type = ref.get("type")
                if ref_type not in ("quoted", "replied_to"):
                    continue
                ref_id = str(ref.get("id") or "")
                if not ref_id:
                    continue
                if ref_id in primary_ids:
                    # Source already in this page as a primary post — link only.
                    primary_post.enrichment_dependency_post_id = ref_id
                    primary_post.enrichment_dependency_type = ref_type
                    continue
                ref_tweet = tweets_by_id.get(ref_id)
                if not ref_tweet:
                    continue  # not hydrated — fall back to defensive cache
                if ref_id not in unpacked:
                    unpacked[ref_id] = parse_x_post(ref_tweet, includes)
                primary_post.enrichment_dependency_post_id = ref_id
                primary_post.enrichment_dependency_type = ref_type

        return list(unpacked.values())

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

    # ------------------------------------------------------------------
    # Comments fetch — /2/tweets/search/all conversation_id:<id>
    # ------------------------------------------------------------------

    # Narrower field set than DEFAULT_TWEET_FIELDS — context_annotations would
    # force max_results <= 100 (PAYG quirk); we already cap there, and the
    # `note_tweet` + `referenced_tweets` fields are what matters for replies.
    _COMMENT_TWEET_FIELDS = (
        "created_at,lang,public_metrics,referenced_tweets,"
        "conversation_id,author_id,in_reply_to_user_id,note_tweet,possibly_sensitive"
    )
    _COMMENT_USER_FIELDS = (
        "username,name,verified,public_metrics,profile_image_url,description,created_at,location"
    )
    _COMMENT_EXPANSIONS = "author_id,referenced_tweets.id,in_reply_to_user_id"
    _COMMENT_PAGE_SIZE = 100  # PAYG cap on /search/all when context_annotations isn't requested
    # X /search/all defaults to "recency" — wrong choice when we sample a
    # subset of a large thread (would yield only the newest 500). "relevancy"
    # surfaces top/engaged replies first; full-tree fetches still come in
    # whatever order, just with the high-signal slice up front.
    _COMMENT_SORT_ORDER = "relevancy"

    def fetch_comments(self, post: dict) -> CommentBatch:
        post_id = post.get("post_id") or extract_twitter_id(post.get("post_url") or "")
        if not post_id:
            logger.warning("X API: cannot extract tweet id from %s", post)
            return CommentBatch()

        settings = get_settings()
        max_pages = max(1, int(settings.x_api_max_comment_pages))

        # 1. Resolve conversation_id (defensive: falls back to post_id if lookup fails).
        try:
            root_resp = self._client.get(
                f"tweets/{post_id}",
                params={"tweet.fields": "conversation_id"},
            )
            conversation_id = (root_resp.get("data") or {}).get("conversation_id") or post_id
        except (XAPIError, requests.RequestException) as e:
            logger.warning("X API: root tweet lookup failed for %s (%s) — using post_id as conversation_id", post_id, e)
            conversation_id = post_id

        # 2. Page /search/all conversation_id:<id>.
        comments: list[Comment] = []
        channels_by_id: dict[str, Channel] = {}
        next_token: str | None = None
        for page in range(max_pages):
            params = {
                "query": f"conversation_id:{conversation_id}",
                "max_results": self._COMMENT_PAGE_SIZE,
                "sort_order": self._COMMENT_SORT_ORDER,
                "tweet.fields": self._COMMENT_TWEET_FIELDS,
                "user.fields": self._COMMENT_USER_FIELDS,
                "expansions": self._COMMENT_EXPANSIONS,
            }
            if next_token:
                params["pagination_token"] = next_token
            try:
                resp = self._client.get("tweets/search/all", params=params)
            except (XAPIError, requests.RequestException) as e:
                logger.warning("X API: search/all failed on page %d for %s: %s", page, post_id, e)
                break

            includes = resp.get("includes") or {}
            users_by_id = _index_users_by_id(includes)
            for user in includes.get("users") or []:
                uid = str(user.get("id") or "")
                if uid and uid not in channels_by_id:
                    channels_by_id[uid] = parse_comment_author(user)

            for tweet in resp.get("data") or []:
                comments.append(parse_comment(tweet, users_by_id))

            next_token = (resp.get("meta") or {}).get("next_token")
            if not next_token:
                break

        # 3. Resolve thread roots in-memory.
        resolve_comment_roots(comments, post_id=post_id)

        # 4. Stamp crawl_provider.
        for c in comments:
            c.crawl_provider = "xapi"

        logger.info(
            "X API: fetched %d comments + %d authors for post %s",
            len(comments), len(channels_by_id), post_id,
        )
        return CommentBatch(comments=comments, channels=list(channels_by_id.values()))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_time_window(
    time_range: dict,
    end_lag_seconds: int = 10,
) -> tuple[str, str]:
    """Convert collection_service's {start, end} dict to RFC 3339 strings.

    `/tweets/search/all` accepts the full archive (back to 2006-03-21), so we
    pass the requested window through. Defensive fallback only: if start is
    missing, snap to (now - _DEFAULT_FALLBACK_DAYS); if end is missing, use now.
    `end_lag_seconds` pushes end_time backward from now (default 10s to satisfy
    X API's "end_time must be at least 10 seconds before now" rule; raise to
    7200 for the 2h engagement-settle lag). Always emits 'Z' UTC suffix.
    """
    now = datetime.now(timezone.utc)
    lag = max(10, int(end_lag_seconds))  # never less than X's 10s floor

    start = _parse_date_loose(time_range.get("start"))
    end = _parse_date_loose(time_range.get("end"))

    if start is None:
        start = now - timedelta(days=_DEFAULT_FALLBACK_DAYS)
    if end is None or end > now:
        end = now
    if end <= start:
        end = now

    end = min(end, now - timedelta(seconds=lag))
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


def _normalize_has_media(value) -> str:
    """Coerce config has_media to {with, without, any}. Defaults to 'with'."""
    if not value:
        return _DEFAULT_HAS_MEDIA
    v = str(value).strip().lower()
    return v if v in _VALID_HAS_MEDIA else _DEFAULT_HAS_MEDIA
