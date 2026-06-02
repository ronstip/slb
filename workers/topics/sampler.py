"""Signature-based diversity sampler for LLM topic taxonomy.

Goal: pick ~target_size posts from a potentially much larger pool such that
niche combinations (rare brand x rare theme x rare content_type, on a less
common platform, in any part of the window) survive into the sample. The
sample is what pass 1 sees, so anything not represented here will never
become a topic.

Strategy:
  1. Compute a 6-dimensional signature per post:
       (platform, channel_type, top_theme, top_brand, content_type, time_bucket)
     top_theme/top_brand = alphabetically-first list element, or "_none".
     time_bucket = the post's quartile within the recency window.
  2. Compute weighted engagement score per post.
  3. Group by signature; within each, sort by engagement; keep top `per_signature`
     while enforcing <= channel_cap per channel_id within the same signature.
  4. If still over budget, trim from over-represented signatures' lowest-
     engagement members until at target.
  5. If still under budget, fill with highest-engagement unsampled posts
     that expand the signature space (no signature picked up >=per_signature
     entries unless we ran out of new signatures).

Engagement weights chosen so that scarcer signals (saves, comments) carry
more - matches the existing intuition elsewhere in the codebase.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)


# Engagement weighting: views are cheap, saves/comments are scarce signal.
ENG_W_VIEWS = 1.0
ENG_W_LIKES = 3.0
ENG_W_COMMENTS = 5.0
ENG_W_SHARES = 2.0
ENG_W_SAVES = 4.0

DEFAULT_TIME_BUCKETS = 4
DEFAULT_PER_SIGNATURE = 3
DEFAULT_CHANNEL_CAP = 3
NONE_TOKEN = "_none"


def _safe_lower(s: Any) -> str:
    if not s:
        return NONE_TOKEN
    return str(s).strip().lower() or NONE_TOKEN


def _first_or_none(items: Any) -> str:
    if not items:
        return NONE_TOKEN
    if isinstance(items, str):
        # Handle BQ JSON-string edge case
        items = [items]
    try:
        cleaned = sorted(str(x).strip().lower() for x in items if x)
    except TypeError:
        return NONE_TOKEN
    return cleaned[0] if cleaned else NONE_TOKEN


def _parse_posted_at(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _channel_key(post: dict) -> str:
    return str(post.get("channel_id") or post.get("channel_handle") or "_")


def engagement_score(post: dict) -> float:
    return (
        float(post.get("views") or 0) * ENG_W_VIEWS
        + float(post.get("likes") or 0) * ENG_W_LIKES
        + float(post.get("comments_count") or 0) * ENG_W_COMMENTS
        + float(post.get("shares") or 0) * ENG_W_SHARES
        + float(post.get("saves") or 0) * ENG_W_SAVES
    )


def _time_bucket(
    posted_at: datetime | None,
    window_start: datetime,
    window_end: datetime,
    buckets: int,
) -> int:
    if posted_at is None:
        return 0
    total = (window_end - window_start).total_seconds()
    if total <= 0:
        return 0
    elapsed = (posted_at - window_start).total_seconds()
    if elapsed < 0:
        return 0
    if elapsed >= total:
        return buckets - 1
    return min(buckets - 1, int(elapsed / total * buckets))


def compute_signature(
    post: dict,
    window_start: datetime,
    window_end: datetime,
    buckets: int = DEFAULT_TIME_BUCKETS,
) -> tuple[str, str, str, str, str, int]:
    return (
        _safe_lower(post.get("platform")),
        _safe_lower(post.get("channel_type")),
        _first_or_none(post.get("themes")),
        _first_or_none(post.get("detected_brands")),
        _safe_lower(post.get("content_type")),
        _time_bucket(
            _parse_posted_at(post.get("posted_at")),
            window_start,
            window_end,
            buckets,
        ),
    )


def _derive_window(posts: list[dict]) -> tuple[datetime, datetime]:
    """Infer the recency window from the posts themselves so the time-bucket
    dimension is meaningful even when the caller hasn't passed explicit bounds.
    """
    times = [
        _parse_posted_at(p.get("posted_at")) for p in posts
    ]
    times = [t for t in times if t is not None]
    if not times:
        now = datetime.now(timezone.utc)
        return now - timedelta(days=7), now
    return min(times), max(times)


def sample_for_taxonomy(
    posts: list[dict],
    target_size: int = 1000,
    per_signature: int = DEFAULT_PER_SIGNATURE,
    channel_cap: int = DEFAULT_CHANNEL_CAP,
    time_buckets: int = DEFAULT_TIME_BUCKETS,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
) -> tuple[list[dict], dict[str, Any]]:
    """Pick a diversity-preserving sample of `posts`.

    Returns (sampled_posts, stats). `stats` summarises signature coverage and
    is intended for logging / dashboards / the early checkpoint.
    """
    n = len(posts)
    if n <= target_size:
        return list(posts), _stats(posts, posts, window_start, window_end, time_buckets)

    if window_start is None or window_end is None:
        ws, we = _derive_window(posts)
        window_start = window_start or ws
        window_end = window_end or we

    # Annotate each post with signature and engagement.
    enriched: list[tuple[tuple, float, dict]] = []
    for p in posts:
        sig = compute_signature(p, window_start, window_end, time_buckets)
        enriched.append((sig, engagement_score(p), p))

    # Phase 1: group by signature, sort each group by engagement DESC,
    # take top-per_signature with per-channel cap. Per-(sig, channel) counters
    # persist across phases so the fill phase can't bypass the channel cap.
    by_sig: dict[tuple, list[tuple[float, dict]]] = defaultdict(list)
    for sig, eng, post in enriched:
        by_sig[sig].append((eng, post))

    capped: list[tuple[tuple, float, dict]] = []
    per_sig_channel: dict[tuple, Counter] = defaultdict(Counter)
    for sig, group in by_sig.items():
        group.sort(key=lambda x: x[0], reverse=True)
        added = 0
        for eng, post in group:
            if added >= per_signature:
                break
            channel = _channel_key(post)
            if per_sig_channel[sig][channel] >= channel_cap:
                continue
            capped.append((sig, eng, post))
            per_sig_channel[sig][channel] += 1
            added += 1

    # Phase 2: if over budget, drop from over-represented signatures' tails.
    if len(capped) > target_size:
        # Build per-signature lists in capped order (which is engagement-sorted
        # within each signature thanks to phase 1).
        per_sig_sorted: dict[tuple, list[tuple[float, dict]]] = defaultdict(list)
        for sig, eng, post in capped:
            per_sig_sorted[sig].append((eng, post))

        # Greedy trim: at each step, drop the lowest-engagement member of the
        # currently-largest signature. Repeat until at budget.
        total = len(capped)
        while total > target_size:
            # Find signature with the most members (ties broken by lowest
            # tail-engagement, which we prefer to drop first).
            biggest_sig = max(
                per_sig_sorted.keys(),
                key=lambda s: (len(per_sig_sorted[s]), -per_sig_sorted[s][-1][0]),
            )
            per_sig_sorted[biggest_sig].pop()
            if not per_sig_sorted[biggest_sig]:
                del per_sig_sorted[biggest_sig]
            total -= 1

        capped = [
            (sig, eng, post)
            for sig, members in per_sig_sorted.items()
            for (eng, post) in members
        ]
        # Rebuild per-(sig, channel) counters to reflect trims so any
        # downstream code (none today, but future-proof) sees consistent state.
        per_sig_channel = defaultdict(Counter)
        for sig, _, post in capped:
            per_sig_channel[sig][_channel_key(post)] += 1

    # Phase 3: if under budget, fill from unsampled high-engagement posts that
    # expand signature coverage. Prefer signatures we haven't picked at all
    # yet, then signatures still under `per_signature`. Channel cap is
    # enforced in all phases - a single channel can't dominate any signature.
    elif len(capped) < target_size:
        chosen_ids = {id(p) for _, _, p in capped}
        sig_counts: Counter = Counter(sig for sig, _, _ in capped)
        # Unsampled posts sorted by engagement DESC.
        leftovers = [
            (sig, eng, post)
            for sig, eng, post in enriched
            if id(post) not in chosen_ids
        ]
        leftovers.sort(key=lambda x: x[1], reverse=True)

        # Two passes over leftovers: (a) only NEW signatures, (b) anything.
        for accept_predicate in (
            lambda s: s not in sig_counts,
            lambda s: True,
        ):
            for sig, eng, post in leftovers:
                if len(capped) >= target_size:
                    break
                if id(post) in chosen_ids:
                    continue
                if not accept_predicate(sig):
                    continue
                channel = _channel_key(post)
                if per_sig_channel[sig][channel] >= channel_cap:
                    continue
                capped.append((sig, eng, post))
                chosen_ids.add(id(post))
                sig_counts[sig] += 1
                per_sig_channel[sig][channel] += 1
            if len(capped) >= target_size:
                break

    sampled = [post for _, _, post in capped]
    stats = _stats(posts, sampled, window_start, window_end, time_buckets)
    logger.info(
        "Topic sample: %d/%d posts, %d distinct signatures (of %d in pool)",
        stats["sample_size"], stats["pool_size"],
        stats["distinct_signatures_sampled"], stats["distinct_signatures_pool"],
    )
    return sampled, stats


def _stats(
    pool: list[dict],
    sample: list[dict],
    window_start: datetime | None,
    window_end: datetime | None,
    time_buckets: int,
) -> dict[str, Any]:
    if window_start is None or window_end is None:
        ws, we = _derive_window(pool)
        window_start = window_start or ws
        window_end = window_end or we

    def _sig_counter(rows):
        return Counter(
            compute_signature(p, window_start, window_end, time_buckets) for p in rows
        )

    pool_sigs = _sig_counter(pool)
    sample_sigs = _sig_counter(sample)
    platforms = Counter(_safe_lower(p.get("platform")) for p in sample)
    channel_types = Counter(_safe_lower(p.get("channel_type")) for p in sample)
    content_types = Counter(_safe_lower(p.get("content_type")) for p in sample)
    top_themes = Counter(_first_or_none(p.get("themes")) for p in sample)
    top_brands = Counter(_first_or_none(p.get("detected_brands")) for p in sample)
    time_buckets_dist = Counter(
        compute_signature(p, window_start, window_end, time_buckets)[5]
        for p in sample
    )

    return {
        "pool_size": len(pool),
        "sample_size": len(sample),
        "distinct_signatures_pool": len(pool_sigs),
        "distinct_signatures_sampled": len(sample_sigs),
        "signature_coverage_ratio": (
            len(sample_sigs) / len(pool_sigs) if pool_sigs else 1.0
        ),
        "platform_dist": dict(platforms),
        "channel_type_dist": dict(channel_types),
        "content_type_dist": dict(content_types),
        "top_theme_dist": dict(top_themes.most_common(20)),
        "top_brand_dist": dict(top_brands.most_common(20)),
        "time_bucket_dist": {int(k): v for k, v in time_buckets_dist.items()},
    }
