"""Persistence for LLM-taxonomy topics.

Writes to BigQuery `social_listening.topic_clusters` — one row per topic with
denormalised membership (member_post_ids ARRAY), real aggregates over
sampled members (sentiment counts, view/like/comment/share totals,
earliest/median/latest post time), and extrapolated full-pool metrics
(per-topic blowup factor = estimated_post_count / post_count).

Topic UUIDs are assigned here (not in pass-2) so the same Topic object can be
re-written without changing IDs.

Also updates `agents/{agent_id}` agent-doc fields: `topics_count`,
`topics_generated_at`, `topics_algorithm_version`. The per-cluster
`topics/` Firestore subcollection was retired in favour of
`topic_metrics(@agent_id)`; readers query that TVF directly.
"""

from __future__ import annotations

import logging
import math
import statistics
import uuid
from datetime import datetime, timezone
from typing import Any

from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.topics.schema import Topic

logger = logging.getLogger(__name__)

# Mirror brothers_v1 — top-K by engagement become "representatives".
MAX_REPRESENTATIVES = 6
ALGORITHM_VERSION = "llm_taxonomy_v2"

# Recency score: matches brothers_v1 (exp-decay with 7-day half-life). Kept
# here so the topic doc shape stays consistent between algorithms.
_RECENCY_HALF_LIFE_DAYS = 7.0
_RECENCY_LAMBDA = math.log(2) / _RECENCY_HALF_LIFE_DAYS


def write_topic_results(
    agent_id: str,
    topics: list[Topic],
    sampled_posts: list[dict[str, Any]],
    *,
    bq: BQClient | None = None,
    fs: FirestoreClient | None = None,
    delete_existing: bool = True,
    clustered_at: datetime | None = None,
) -> dict[str, Any]:
    """Write topics to BQ and Firestore. Returns counts of rows written.

    `sampled_posts` is the same list that pass-1 saw — we look up metadata
    (engagement score, posted_at, collection_id) keyed by post_id.
    """
    bq = bq or BQClient()
    fs = fs or FirestoreClient()
    clustered_at = clustered_at or datetime.now(timezone.utc)
    clustered_at_iso = clustered_at.isoformat()

    pid_to_post = {p["post_id"]: p for p in sampled_posts}

    topic_uuids = [str(uuid.uuid4()) for _ in topics]

    cluster_rows = [
        _build_topic_cluster_row(
            agent_id, t, uid, pid_to_post, clustered_at, clustered_at_iso,
        )
        for t, uid in zip(topics, topic_uuids)
    ]

    cluster_rows_written = 0
    if cluster_rows:
        for i in range(0, len(cluster_rows), 500):
            bq.insert_rows("topic_clusters", cluster_rows[i : i + 500])
        cluster_rows_written = len(cluster_rows)
        logger.info(
            "Wrote %d topic_clusters rows to BQ for agent %s",
            cluster_rows_written, agent_id,
        )

    # Agent-doc metadata (summary fields the studio header reads). The
    # per-cluster `topics/` subcollection used to be the readers' source; that
    # role moved to `topic_metrics(@agent_id)`.
    fs.update_agent(
        agent_id,
        topics_count=len(topics),
        topics_generated_at=clustered_at,
        topics_algorithm_version=ALGORITHM_VERSION,
    )

    # `delete_existing` retained for signature back-compat: there is no
    # subcollection to delete anymore, but callers (tests, manual runs) may
    # still pass it.
    del delete_existing

    return {
        "topics_written": len(topics),
        "topic_clusters_written": cluster_rows_written,
        "algorithm_version": ALGORITHM_VERSION,
    }


def _representative_post_ids(
    member_post_ids: list[str], pid_to_post: dict[str, dict],
) -> list[str]:
    """Top-K post_ids by engagement weight. Mirrors brothers_v1 logic."""
    scored = []
    for pid in member_post_ids:
        post = pid_to_post.get(pid) or {}
        engagement = (
            float(post.get("views") or 0)
            + float(post.get("likes") or 0) * 10
            + float(post.get("comments_count") or 0) * 20
            + float(post.get("shares") or 0) * 5
            + float(post.get("saves") or 0) * 5
        )
        scored.append((engagement, pid))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [pid for _, pid in scored[:MAX_REPRESENTATIVES]]


def _build_topic_cluster_row(
    agent_id: str,
    t: Topic,
    cluster_uuid: str,
    pid_to_post: dict[str, dict],
    clustered_at: datetime,
    clustered_at_iso: str,
) -> dict[str, Any]:
    """One row per topic. Denormalises membership and materialises
    real + extrapolated aggregates so readers don't need to join scope_posts.
    """
    member_posts = [pid_to_post.get(pid) or {} for pid in t.member_post_ids]
    rep_ids = _representative_post_ids(t.member_post_ids, pid_to_post)
    post_count = len(t.member_post_ids)

    # Real aggregates over the sampled members
    total_views = sum(int(p.get("views") or 0) for p in member_posts)
    total_likes = sum(int(p.get("likes") or 0) for p in member_posts)
    total_comments = sum(int(p.get("comments_count") or 0) for p in member_posts)
    total_shares = sum(int(p.get("shares") or 0) for p in member_posts)

    sent_counts = {"positive": 0, "negative": 0, "neutral": 0, "mixed": 0}
    for p in member_posts:
        s = (p.get("sentiment") or "").lower()
        if s in sent_counts:
            sent_counts[s] += 1

    earliest, median_t, latest = _post_time_stats(member_posts)

    # Extrapolation: post-stratified count from the extrapolator drives the
    # per-topic blowup factor. Apply that factor to real engagement metrics
    # to estimate full-pool engagement. Approximation: assumes engagement
    # scales with count within the topic.
    est_post_count = int(t.estimated_pool_count or 0)
    factor = (est_post_count / post_count) if post_count > 0 else 1.0

    return {
        "agent_id": agent_id,
        "cluster_id": cluster_uuid,
        "clustered_at": clustered_at_iso,
        "algorithm_version": ALGORITHM_VERSION,
        # definition
        "header": t.header,
        "subheader": t.subheader,
        "beat_type": getattr(t, "beat_type", None),
        "keywords": list(t.keywords or []),
        "anchor_entities": list(t.anchor_entities or []),
        "anchor_themes": list(t.anchor_themes or []),
        "anchor_brands": list(t.anchor_brands or []),
        "anchor_content_types": list(t.anchor_content_types or []),
        # membership
        "member_post_ids": list(t.member_post_ids or []),
        "representative_post_ids": rep_ids,
        "post_count": post_count,
        # real aggregates
        "total_views": total_views,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_shares": total_shares,
        "positive_count": sent_counts["positive"],
        "negative_count": sent_counts["negative"],
        "neutral_count": sent_counts["neutral"],
        "mixed_count": sent_counts["mixed"],
        "earliest_post": earliest.isoformat() if earliest else None,
        "median_post_time": median_t.isoformat() if median_t else None,
        "latest_post": latest.isoformat() if latest else None,
        # extrapolated
        "estimated_post_count": est_post_count,
        "estimated_views": int(round(total_views * factor)),
        "estimated_likes": int(round(total_likes * factor)),
        "estimated_comments": int(round(total_comments * factor)),
        "estimated_shares": int(round(total_shares * factor)),
        # ranking
        "recency_score": _recency_score(member_posts, clustered_at),
    }


def _post_time_stats(
    member_posts: list[dict],
) -> tuple[datetime | None, datetime | None, datetime | None]:
    """Returns (earliest, median, latest) posted_at across member posts.

    Median uses median_low to avoid datetime averaging — "where is the mass"
    is fine with the lower of the two middle values on even-length lists.
    """
    times: list[datetime] = []
    for p in member_posts:
        pa = p.get("posted_at")
        if not pa:
            continue
        if isinstance(pa, str):
            try:
                pa = datetime.fromisoformat(pa.replace("Z", "+00:00"))
            except ValueError:
                continue
        if pa.tzinfo is None:
            pa = pa.replace(tzinfo=timezone.utc)
        times.append(pa)
    if not times:
        return None, None, None
    times.sort()
    return times[0], statistics.median_low(times), times[-1]


def _recency_score(member_posts: list[dict], now: datetime) -> float:
    """Match brothers_v1 recency: sum of exp(-lambda * age_days). Half-life 7d."""
    score = 0.0
    for p in member_posts:
        posted_at = p.get("posted_at")
        if not posted_at:
            continue
        if isinstance(posted_at, str):
            try:
                posted_at = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
            except ValueError:
                continue
        if posted_at.tzinfo is None:
            posted_at = posted_at.replace(tzinfo=timezone.utc)
        age_days = max(0.0, (now - posted_at).total_seconds() / 86400.0)
        score += math.exp(-_RECENCY_LAMBDA * age_days)
    return round(score, 4)
