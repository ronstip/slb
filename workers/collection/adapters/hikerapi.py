"""HikerAPI Instagram adapter - keyword collection (reels SERP + hashtag backfill).

HikerAPI reaches Instagram's logged-in `fbsearch_reels_v2` search surface
(cross-platform keyword search for reels), which returns viral content the
hashtag-page surfaces (Apify's apidojo actor) physically can't reach.

IMPORTANT yield caveat (verified live 2026-06-10): the reels SERP does NOT
paginate. The server returns the same `reels_max_id` cursor on every page and
re-serves (a shuffle of) the same module - echoing `rank_token` back doesn't
help either. One keyword tops out around ~20-45 unique reels no matter how
many pages are requested. The v1 hashtag chunk endpoints, by contrast,
paginate properly (~150+ new media per page, verified in
logs/runs/pilot_hiker_hashtag-top_*.json).

So collection per keyword runs in PHASES, each with a BUDGET SLICE of the
per-keyword target (see `_KeywordStream._PHASE_BUDGET`):
  1. `fbsearch_reels_v2`        - viral keyword SERP (best content, low yield) - 20%
  2. `fbsearch_topsearch_v2`    - top posts for the RAW keyword (free-text
       universal search; accepts spaces/phrases - NO hashtagizing) - 50%
  3. `hashtag_medias_top_recent_chunk_v1` - recent posts for #keyword - 30%
  4. `hashtag_medias_clips_chunk_v1` - reels for #keyword - backfill only

Each phase hands off once it fills its slice, so reels (which saturates fast on
old viral content) can't eat the whole budget and starve `hashtag_recent` - the
only time-ordered surface, and the one that fills a narrow time window. A phase
that comes up short rolls its deficit to the next; if the weighted surfaces all
run dry below target, a final UNCAPPED backfill sweep resumes whatever surface
still has pages (volume beats an exact split when the data isn't there).

Why "top" is free-text but "recent"/"clips" are hashtag-keyed: HikerAPI's
top-posts surface is `/v2/fbsearch/topsearch`, a universal keyword search that
takes any query string verbatim (spaces and all). The recent/clips surfaces
only exist as `/v1/hashtag/medias/...` endpoints, which are keyed by a hashtag
`name` (no spaces possible) - so those two still collapse the keyword to a
hashtag via `_hashtagize`.

And collection across keywords POOLS to the run's total `n_posts` budget:
after the per-keyword round, underfilled budget is redistributed to keywords
that can still produce, so one dry keyword doesn't starve the run.

NO TIME GATE here: none of these surfaces accept a date parameter, so every
fetched post is already paid for. The adapter returns everything (the
pipeline's `partition_by_time_range` stores out-of-window posts but skips
enrichment - same treatment as the Apify/TikTok flow). The only
window-awareness is the final trim: when results exceed `n_posts`, in-window
posts are kept first so the user's actual ask wins over old viral extras.

Funnel: reported through the standard wrapper funnel (`funnel_stats`,
aggregated by `DataProviderWrapper.get_funnel_stats` into the admin
Collections audit), same as BrightData/Apify. Keys: hiker_requests,
hiker_raw_media, hiker_duplicates, hiker_parse_failures, hiker_valid_posts.

Scope (v1): KEYWORD collection only. This surface can't resolve a specific
post URL, so:
  - `collect()` ignores `post_urls` (returns nothing for that mode).
  - `fetch_engagements` / `fetch_comments` are no-ops.
  - `supported_url_platforms()` returns `[]` so the wrapper routes URL-based
    work (engagement refresh, direct post-by-URL fetch) to a URL-capable
    provider (Apify) instead. Apify refreshes hiker-collected posts fine via
    their canonical /p/{code}/ URLs.

Cost: HikerAPI returns no per-call cost and bills per REQUEST (tiered by
account balance - see config/cost_rates.py). We log `units=requests_made`
(across ALL phases), `unit_kind="requests"`, priced via the rate table.
The pipeline runner must NOT also emit a per-post rate-table event for
hikerapi (workers/pipeline/runner.py skips self-logging providers).
"""

from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from math import ceil

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.hikerapi_parsers import (
    parse_hikerapi_instagram_channel,
    parse_hikerapi_instagram_post,
)
from workers.collection.models import Batch, Channel, CommentBatch, Post

logger = logging.getLogger(__name__)

_MAX_WORKERS_KEYWORDS = 5
# Advance to the next phase after this many CONSECUTIVE pages add zero new
# unique posts - the surface has saturated / started looping even if it still
# claims has_more (the reels SERP ALWAYS does this after page 1-2).
_SATURATION_PAGES = 2


def _extract_media(obj, out: list[dict]) -> None:
    """Recursively pull native IG media objects out of any HikerAPI response
    shape (reels SERP modules, chunk tuples, etc.). A dict is a media object if
    it carries an id AND an engagement counter. Lifted from the validated pilot
    (scripts/pilot_hikerapi_ig.py)."""
    if isinstance(obj, dict):
        has_id = "pk" in obj or "id" in obj
        has_engagement = any(
            k in obj for k in ("like_count", "play_count", "comment_count", "view_count")
        )
        if has_id and has_engagement:
            out.append(obj)
            # don't return - a carousel/media may nest child media we also want
        for v in obj.values():
            _extract_media(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _extract_media(v, out)


def _parse_gate(value) -> datetime | None:
    """Parse a time-range bound (ISO string / epoch / datetime) to tz-aware UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _hashtagize(keyword: str) -> str:
    """Keyword -> hashtag name: '#Rip the Script!' -> 'ripthescript'."""
    return re.sub(r"\W+", "", keyword, flags=re.UNICODE).lower()


class HikerAPIAccountError(RuntimeError):
    """Account-level failure (e.g. InsufficientFunds) - no endpoint will serve."""


def _raise_on_account_error(resp) -> None:
    """HikerAPI signals account problems in a 200 body:
    ``{'state': False, 'error': 'Top up…', 'exc_type': 'InsufficientFunds'}``.
    Raise so the run fails loudly instead of looking like an empty SERP."""
    if isinstance(resp, dict) and resp.get("state") is False and resp.get("error"):
        raise HikerAPIAccountError(f"{resp.get('exc_type') or 'error'}: {resp.get('error')}")


class _KeywordStream:
    """Stateful per-keyword collector that can be pulled repeatedly.

    Holds pagination state across phases so the pooling loop in
    ``HikerAPIAdapter.collect`` can come back for more when other keywords
    underfill. ``pull()`` is only ever called by one thread at a time.
    """

    _PHASES = ("reels_serp", "topsearch", "hashtag_recent", "hashtag_clips")

    # How the per-keyword target is split across the first three surfaces, as a
    # CUMULATIVE fraction of `self.target` (reels 20% -> topsearch +50% -> recent
    # +30% = 100%). A phase stops contributing once the stream reaches its
    # cumulative ceiling, so each surface gets a guaranteed slice instead of
    # reels (which saturates fast on old viral content) eating the whole budget
    # and starving `hashtag_recent` - the only time-ordered surface. Deficits
    # roll forward automatically: a phase that comes up short leaves a higher
    # remaining share for the next phase. `hashtag_clips` carries the full
    # target so it can backfill any residual gap.
    _PHASE_BUDGET = {
        "reels_serp": 0.20,
        "topsearch": 0.70,
        "hashtag_recent": 1.0,
        "hashtag_clips": 1.0,
    }

    def __init__(self, adapter: "HikerAPIAdapter", keyword: str):
        self._adapter = adapter
        self.keyword = keyword
        self._hashtag = _hashtagize(keyword)

        self.posts: list[Post] = []
        self.channels: dict[str, Channel] = {}
        self.target = 0  # raised by the pooling loop
        self.exhausted = False

        # Funnel counters (stream totals; aggregated into the adapter's
        # standard `funnel_stats` for the admin Collections audit).
        self.raw_media = 0
        self.duplicates = 0
        self.parse_failures = 0

        self._seen_pks: set[str] = set()
        self._phase_idx = 0
        self._cursor = None
        self._empty_streak = 0
        self._pages_used = 0
        self._phase_funnel = {"pages": 0, "raw": 0, "new": 0}
        # Per-phase resume state for the budget split (see _PHASE_BUDGET):
        # `_phase_cursor` remembers where a phase left off when it handed off
        # after filling its slice (so a later uncapped backfill sweep can pick
        # it back up); `_phase_saturated` marks surfaces that ran dry/errored so
        # the backfill sweep skips them. `_budget_mode` is dropped for the
        # backfill sweep so a remaining-rich surface can exceed its slice when
        # the weighted surfaces couldn't fill the target. `_phase_buffer` holds
        # PAID media that a phase already fetched but couldn't append because it
        # hit its budget slice mid-page - stashed (not discarded) so the backfill
        # sweep / a raised-target re-pull can drain it with no extra request.
        self._phase_cursor: list = [None] * len(self._PHASES)
        self._phase_saturated: list[bool] = [False] * len(self._PHASES)
        self._phase_buffer: list[list] = [[] for _ in self._PHASES]
        self._budget_mode = True

    # -- phase plumbing -------------------------------------------------

    def _fetch_page(self):
        """One request for the current phase -> (media_objs, next_cursor, has_more)."""
        phase = self._PHASES[self._phase_idx]
        client = self._adapter._client
        if phase == "reels_serp":
            resp = client.fbsearch_reels_v2(self.keyword, reels_max_id=self._cursor)
            _raise_on_account_error(resp)
            if not isinstance(resp, dict):
                return [], None, False
            media: list[dict] = []
            _extract_media(resp, media)
            cursor = resp.get("reels_max_id")
            # The SERP re-serves the same cursor forever; treat a non-advancing
            # cursor as "may continue" and let the saturation streak stop us.
            return media, cursor, bool(resp.get("has_more") and cursor)
        if phase == "topsearch":
            # Top posts via IG's universal keyword search. Send the RAW keyword
            # verbatim - this endpoint takes any query string (spaces/phrases),
            # so there is NO hashtagizing here (that would mangle multi-word and
            # non-Latin keywords). Media live under `media_grid`; it paginates
            # via `media_grid.next_max_id`.
            resp = client.fbsearch_topsearch_v2(self.keyword, next_max_id=self._cursor)
            _raise_on_account_error(resp)
            if not isinstance(resp, dict):
                return [], None, False
            media = []
            _extract_media(resp, media)
            grid = resp.get("media_grid") or {}
            cursor = grid.get("next_max_id")
            return media, cursor, bool(grid.get("has_more") and cursor)
        if phase == "hashtag_recent":
            resp = client.hashtag_medias_top_recent_chunk_v1(self._hashtag, max_id=self._cursor)
        else:
            resp = client.hashtag_medias_clips_chunk_v1(self._hashtag, max_id=self._cursor)
        _raise_on_account_error(resp)
        # v1 chunk endpoints return [media_list, next_max_id] (sometimes a dict
        # on error shapes) - extract media from whatever came back.
        media = []
        _extract_media(resp, media)
        next_cursor = None
        if isinstance(resp, (list, tuple)) and len(resp) == 2:
            next_cursor = resp[1]
        elif isinstance(resp, dict):
            next_cursor = resp.get("next_max_id") or resp.get("max_id")
        return media, next_cursor, bool(media and next_cursor)

    def _advance_phase(self, *, resumable: bool = False, resume_cursor=None) -> None:
        """Hand off the current phase. Pass ``resumable=True`` when the phase
        only stopped because it filled its budget slice and can still produce -
        either it has more pages (pass ``resume_cursor``) or it left PAID media
        in ``_phase_buffer``. The surface is then remembered so a later uncapped
        backfill sweep can resume it. ``resumable=False`` marks the surface
        saturated (dry / errored / no more pages) and it won't be revisited."""
        f = self._phase_funnel
        if f["pages"]:
            logger.info(
                "HikerAPI '%s' %s done: pages=%d raw=%d new_unique=%d (stream total=%d)",
                self.keyword, self._PHASES[self._phase_idx],
                f["pages"], f["raw"], f["new"], len(self.posts),
            )
        idx = self._phase_idx
        self._phase_cursor[idx] = resume_cursor
        if not resumable:
            self._phase_saturated[idx] = True
        self._phase_funnel = {"pages": 0, "raw": 0, "new": 0}
        self._select_next_phase()

    def _select_next_phase(self) -> None:
        """Move to the next phase that can still produce. At the end of a
        budget sweep that left the target unmet, drop the per-phase caps and
        re-open any non-saturated surface so it can backfill the remainder."""
        while True:
            self._phase_idx += 1
            if self._phase_idx >= len(self._PHASES):
                if (
                    self._budget_mode
                    and len(self.posts) < self.target
                    and any(not s for s in self._phase_saturated)
                ):
                    # Weighted surfaces ran dry below target -> uncapped backfill.
                    self._budget_mode = False
                    self._phase_idx = -1
                    continue
                self.exhausted = True
                return
            if self._phase_saturated[self._phase_idx]:
                continue
            # Skip hashtag phases when the keyword reduces to an empty hashtag.
            if self._PHASES[self._phase_idx].startswith("hashtag") and not self._hashtag:
                self._phase_saturated[self._phase_idx] = True
                continue
            self._cursor = self._phase_cursor[self._phase_idx]
            self._empty_streak = 0
            return

    def _phase_ceiling(self) -> int:
        """Cumulative post count at which the current phase hands off to the
        next (see ``_PHASE_BUDGET``). Capped at ``self.target`` so the final
        phase can fill the remainder. During the uncapped backfill sweep
        (``_budget_mode`` off) there is no per-phase cap. Only meaningful when
        ``self.target`` is set; the caller guards on that."""
        if not self._budget_mode:
            return self.target
        frac = self._PHASE_BUDGET.get(self._PHASES[self._phase_idx], 1.0)
        return min(self.target, max(1, round(self.target * frac)))

    # -- main loop -------------------------------------------------------

    def pull(self) -> int:
        """Collect until ``self.target`` unique posts or every phase is exhausted.

        Returns the number of posts added this call. A target of 0 means
        "no explicit ask" - collect the reels SERP only (legacy behaviour),
        bounded by the page setting. No time filtering happens here - every
        fetched post is paid for and flows to the pipeline, which stores
        out-of-window posts without enriching them.
        """
        added_this_call = 0
        # Backstop only: scale generously with the ask so the requested count
        # is always reachable even on a low-yield term (worst case ~1
        # net-new/page). The saturation streak halts an exhausted term long
        # before this ceiling in practice.
        page_ceiling = self._adapter._max_pages
        if self.target:
            page_ceiling = max(page_ceiling, self.target + 5)

        while not self.exhausted and self._pages_used < page_ceiling:
            if self.target and len(self.posts) >= self.target:
                break
            # No explicit ask -> reels SERP only; hashtag phases are backfill
            # for an unmet target and shouldn't run on an unbounded request.
            if not self.target and self._phase_idx > 0:
                break

            # Drain any PAID leftover this phase stashed when it filled its slice
            # mid-page, before spending another request - those media were
            # already fetched, counted in the funnel, and billed once.
            buffered = self._phase_buffer[self._phase_idx]
            if buffered:
                self._phase_buffer[self._phase_idx] = []
                media = buffered
                next_cursor = self._phase_cursor[self._phase_idx]
                has_more = next_cursor is not None
            else:
                try:
                    media, next_cursor, has_more = self._fetch_page()
                except HikerAPIAccountError as e:
                    # Account-level: every endpoint/keyword fails the same way.
                    logger.error("HikerAPI account error for '%s': %s", self.keyword, e)
                    self._adapter._account_error = str(e)
                    self.exhausted = True
                    break
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "HikerAPI %s page failed for '%s'",
                        self._PHASES[self._phase_idx], self.keyword,
                    )
                    self._advance_phase()
                    continue
                self._pages_used += 1
                with self._adapter._stats_lock:
                    self._adapter._requests_made += 1
                self.raw_media += len(media)
                self._phase_funnel["pages"] += 1
                self._phase_funnel["raw"] += len(media)

            new_unique = 0
            # Per-phase budget: a phase contributes only up to its cumulative
            # slice of the target (reels 20% / topsearch 70% / recent 100%; see
            # _PHASE_BUDGET). Items past the slice are PAID, so they are stashed
            # in _phase_buffer (not discarded) for a later uncapped backfill
            # sweep. The slice caps are off during that sweep (_budget_mode).
            phase_ceiling = self._phase_ceiling() if self.target else None
            for i, item in enumerate(media):
                if phase_ceiling is not None and len(self.posts) >= phase_ceiling:
                    self._phase_buffer[self._phase_idx] = list(media[i:])
                    break
                try:
                    post = parse_hikerapi_instagram_post(item)
                except Exception:  # noqa: BLE001 - one bad item must not kill the keyword
                    self.parse_failures += 1
                    logger.warning("HikerAPI media parse failed - skipping item", exc_info=True)
                    continue
                if not post.post_id or post.post_id in self._seen_pks:
                    self.duplicates += 1
                    continue
                self._seen_pks.add(post.post_id)
                new_unique += 1
                self._phase_funnel["new"] += 1
                post.crawl_provider = "hikerapi"
                post.search_keyword = self.keyword
                self.posts.append(post)
                added_this_call += 1
                try:
                    ch = parse_hikerapi_instagram_channel(item)
                    if ch.channel_id and ch.channel_id not in self.channels:
                        self.channels[ch.channel_id] = ch
                except Exception:  # noqa: BLE001
                    logger.debug("HikerAPI channel parse skipped", exc_info=True)

            self._empty_streak = self._empty_streak + 1 if new_unique == 0 else 0
            phase_filled = phase_ceiling is not None and len(self.posts) >= phase_ceiling

            # Target met: stop WITHOUT advancing/exhausting so global pooling can
            # re-pull this stream (with a raised target) from exactly here - the
            # phase keeps its cursor and any stashed leftover.
            if self.target and len(self.posts) >= self.target:
                self._cursor = next_cursor
                self._phase_cursor[self._phase_idx] = next_cursor
                break

            if phase_filled:
                # Slice full but target unmet -> hand off. The phase can still
                # produce (more pages and/or stashed leftover), so keep it
                # resumable for the uncapped backfill sweep.
                has_leftover = bool(self._phase_buffer[self._phase_idx])
                self._advance_phase(
                    resumable=has_more or has_leftover,
                    resume_cursor=next_cursor if has_more else None,
                )
                continue
            # Saturated (consecutive pages with zero new unique pks -> looping /
            # dry) or nothing more to page -> next surface.
            if self._empty_streak >= _SATURATION_PAGES or not has_more:
                self._advance_phase()
                continue
            self._cursor = next_cursor
            self._phase_cursor[self._phase_idx] = next_cursor

        if self._pages_used >= page_ceiling:
            self.exhausted = True
        return added_this_call


class HikerAPIAdapter(DataProviderAdapter):
    """Instagram keyword collection via HikerAPI (reels SERP + hashtag chunks)."""

    def __init__(self):
        settings = get_settings()
        api_key = getattr(settings, "hikerapi_api_key", "") or ""
        if not api_key:
            raise ValueError("HIKERAPI_API_KEY not configured")
        # Lazy import so the dependency is only required when the adapter is
        # actually instantiated (mirrors other optional-vendor adapters).
        from hikerapi import Client

        self._client = Client(token=api_key)
        self._max_pages = max(1, int(getattr(settings, "hikerapi_max_pages_per_keyword", 3)))
        self._stats_lock = threading.Lock()
        self._platform_stats: dict[str, dict] = {}
        self._funnel: dict = self._fresh_funnel()
        self._requests_made = 0
        self._account_error: str | None = None
        logger.info("HikerAPIAdapter initialized (max_pages_per_keyword=%d)", self._max_pages)

    @staticmethod
    def _fresh_funnel() -> dict:
        return {
            "hiker_requests": 0,
            "hiker_raw_media": 0,
            "hiker_duplicates": 0,
            "hiker_parse_failures": 0,
            "hiker_valid_posts": 0,
            "per_platform": {},
        }

    # ------------------------------------------------------------------
    # Capability surface
    # ------------------------------------------------------------------

    def supported_platforms(self) -> list[str]:
        return ["instagram"]

    def supported_url_platforms(self) -> list[str]:
        # Keyword-only surface: cannot resolve a specific post URL. The wrapper
        # routes URL-based ops (engagement refresh, post-by-URL) elsewhere.
        return []

    def supported_comment_platforms(self) -> list[str]:
        return []

    @property
    def platform_stats(self) -> dict[str, dict]:
        return dict(self._platform_stats)

    @property
    def funnel_stats(self) -> dict:
        """Standard wrapper funnel (admin Collections audit) - see
        DataProviderWrapper._FUNNEL_KEYS."""
        with self._stats_lock:
            return dict(self._funnel)

    # ------------------------------------------------------------------
    # Collection
    # ------------------------------------------------------------------

    def collect(self, config: dict) -> list[Batch]:
        self._requests_made = 0
        self._platform_stats = {}
        self._funnel = self._fresh_funnel()
        self._account_error = None

        platforms = config.get("platforms") or []
        if "instagram" not in platforms:
            return []

        # URL-based modes aren't served by these surfaces - the wrapper should
        # never route them here, but guard defensively so a misroute degrades
        # (empty) instead of silently dropping work as "collected".
        if config.get("post_urls"):
            logger.warning("HikerAPIAdapter received post_urls (URL fetch) - not supported, skipping")
            return []

        keywords = [k for k in (config.get("keywords") or []) if (k or "").strip()]
        if not keywords:
            return []

        try:
            n_total = int(config.get("n_posts") or 0)
        except (TypeError, ValueError):
            n_total = 0
        try:
            cap = int(config.get("max_posts_per_keyword") or 0)
        except (TypeError, ValueError):
            cap = 0
        if not cap:
            cap = n_total  # legacy fallback: no per-keyword slice -> use the total

        streams = [_KeywordStream(self, kw) for kw in keywords]
        for s in streams:
            s.target = cap

        def _run_round(round_streams: list[_KeywordStream]) -> None:
            with ThreadPoolExecutor(
                max_workers=min(len(round_streams), _MAX_WORKERS_KEYWORDS)
            ) as pool:
                futures = {pool.submit(s.pull): s for s in round_streams}
                for future in as_completed(futures):
                    s = futures[future]
                    try:
                        future.result()
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "HikerAPI keyword collection failed for '%s'", s.keyword
                        )
                        s.exhausted = True

        _run_round(streams)

        # Pool to the run's TOTAL budget: redistribute the unmet remainder to
        # keywords that can still produce, so a dry keyword doesn't starve the
        # run (the service splits n_posts evenly across keywords up front).
        if n_total:
            while True:
                self._dedupe_across_streams(streams)
                total = sum(len(s.posts) for s in streams)
                alive = [s for s in streams if not s.exhausted]
                if total >= n_total or not alive:
                    break
                per_stream = ceil((n_total - total) / len(alive))
                for s in alive:
                    s.target = len(s.posts) + per_stream
                before = total
                _run_round(alive)
                self._dedupe_across_streams(streams)
                if sum(len(s.posts) for s in streams) <= before:
                    break  # no forward progress - everything is dry
        else:
            self._dedupe_across_streams(streams)

        # Trim to the requested count. Window-PRIORITIZED, not window-gated:
        # in-window posts are kept first (the user's actual ask), then the
        # most-engaging out-of-window extras fill the remainder. Everything
        # returned is stored by the pipeline; out-of-window posts just skip
        # enrichment (partition_by_time_range).
        time_range = config.get("time_range") or {}
        gate_start = _parse_gate(time_range.get("start"))
        gate_end = _parse_gate(time_range.get("end"))
        if n_total:
            self._trim_global(streams, n_total, gate_start, gate_end)
        elif cap:
            for s in streams:
                if len(s.posts) > cap:
                    s.posts.sort(
                        key=lambda p: self._trim_key(p, gate_start, gate_end), reverse=True,
                    )
                    s.posts = s.posts[:cap]
        for s in streams:
            kept_ch = {p.channel_id for p in s.posts if p.channel_id}
            s.channels = {cid: ch for cid, ch in s.channels.items() if cid in kept_ch}

        batches = [
            Batch(posts=s.posts, channels=list(s.channels.values()))
            for s in streams
            if s.posts
        ]
        total_posts = sum(len(b.posts) for b in batches)

        raw_media = sum(s.raw_media for s in streams)
        duplicates = sum(s.duplicates for s in streams)
        parse_failures = sum(s.parse_failures for s in streams)
        with self._stats_lock:
            self._platform_stats["instagram"] = {
                "posts": total_posts,
                "batches": len(batches),
                "requests": self._requests_made,
            }
            self._funnel = {
                "hiker_requests": self._requests_made,
                "hiker_raw_media": raw_media,
                "hiker_duplicates": duplicates,
                "hiker_parse_failures": parse_failures,
                "hiker_valid_posts": total_posts,
                "per_platform": {
                    "instagram": {
                        "raw_into_parse": raw_media,
                        "deduped": duplicates,
                        "parse_failures": parse_failures,
                        "empty_post_id": 0,
                        "valid_posts": total_posts,
                    }
                },
            }
        logger.info(
            "HikerAPI collected %d post(s) in %d batch(es) from %d request(s) "
            "(raw_media=%d duplicates=%d parse_failures=%d, asked n_posts=%d)",
            total_posts, len(batches), self._requests_made,
            raw_media, duplicates, parse_failures, n_total,
        )

        # Flat per-REQUEST billing: cost = requests_made × rate. No provider
        # cost is returned, so this is the authoritative source. user/org/
        # collection are inherited from the bound collection_context_scope.
        if self._requests_made:
            from api.services.cost_meter import EVENT_PROVIDER, log_cost

            log_cost(
                provider="hikerapi",
                user_id="",
                feature="scrape",
                event_type=EVENT_PROVIDER,
                sub_kind="instagram",
                platform="instagram",
                units=self._requests_made,
                unit_kind="requests",
            )

        # An account-level failure with NOTHING collected must fail the run
        # loudly (crawl error) - a silent empty result reads as "no content
        # matched". Raised AFTER cost logging: the requests that did go out
        # are still billable. With partial results we keep them and just log.
        if self._account_error and total_posts == 0:
            raise RuntimeError(f"HikerAPI account error: {self._account_error}")

        return batches

    @staticmethod
    def _dedupe_across_streams(streams: list[_KeywordStream]) -> None:
        """Drop posts already returned by an earlier keyword (first wins)."""
        seen: set[str] = set()
        for s in streams:
            kept = []
            for p in s.posts:
                if p.post_id in seen:
                    continue
                seen.add(p.post_id)
                kept.append(p)
            s.posts = kept

    @classmethod
    def _trim_key(
        cls, post: Post, gate_start: datetime | None, gate_end: datetime | None,
    ) -> tuple[int, float]:
        """Sort key for trimming: in-window first, then engagement."""
        in_window = 1
        if gate_start and post.posted_at < gate_start:
            in_window = 0
        if gate_end and post.posted_at > gate_end:
            in_window = 0
        return (in_window, cls._engagement_score(post))

    @classmethod
    def _trim_global(
        cls,
        streams: list[_KeywordStream],
        n_total: int,
        gate_start: datetime | None,
        gate_end: datetime | None,
    ) -> None:
        """Keep the best ``n_total`` posts across all streams (in-window first)."""
        everything = [p for s in streams for p in s.posts]
        if len(everything) <= n_total:
            return
        everything.sort(key=lambda p: cls._trim_key(p, gate_start, gate_end), reverse=True)
        keep_ids = {p.post_id for p in everything[:n_total]}
        for s in streams:
            s.posts = [p for p in s.posts if p.post_id in keep_ids]

    @staticmethod
    def _engagement_score(post: Post) -> float:
        return (post.likes or 0) + 2.0 * (post.comments_count or 0) + 0.01 * (post.views or 0)

    # ------------------------------------------------------------------
    # URL-based ops - not served by these surfaces (routed to Apify by the
    # wrapper via supported_url_platforms()/supported_comment_platforms()).
    # ------------------------------------------------------------------

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        logger.warning(
            "HikerAPIAdapter.fetch_engagements called (%d urls) - not supported "
            "(keyword-only surface); returning empty. Routing should send URL "
            "work to a URL-capable provider.", len(post_urls or []),
        )
        return []

    def fetch_comments(self, post: dict) -> CommentBatch:
        raise NotImplementedError("fetch_comments not supported by HikerAPIAdapter (keyword-only surface)")
