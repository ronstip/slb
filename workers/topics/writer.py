"""Persistence for LLM-taxonomy topics.

Writes two destinations:

  1. BigQuery `social_listening.topic_cluster_members` — one row per (topic,
     post). Reuses the brothers_v1 schema for downstream-query compatibility:
       cluster_id, post_id, agent_id, collection_id,
       distance_to_centroid (NULL — algorithm has no embeddings),
       is_representative (top-K by engagement), clustered_at

  2. Firestore `agents/{agent_id}/topics/{cluster_uuid}` — one doc per topic.
     Carries both v1-compat fields (topic_name, topic_summary, topic_keywords,
     post_count, representative_post_ids, recency_score, algorithm_version,
     created_at) and v2-only fields (header, subheader, beat_type,
     anchor_entities/themes/brands/content_types, member_post_ids,
     estimated_pool_count, estimated_pool_count_ci_low/high).

  Topic UUIDs are assigned here (not in pass-2) so the same Topic object can be
  re-written without changing IDs.

Side-effects also include `agents/{agent_id}` updates: `topics_count`,
`topics_generated_at`. Deletes existing topics for the agent before writing
new ones (matches brothers_v1 behaviour — there is only ever one current
topic snapshot per agent).
"""

from __future__ import annotations

import logging
import math
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

    # Assign topic UUIDs deterministically per call so BQ rows + Firestore docs
    # share the same cluster_id.
    topic_uuids = [str(uuid.uuid4()) for _ in topics]

    # 1. BQ rows
    bq_rows = _build_bq_rows(
        agent_id, topics, topic_uuids, pid_to_post, clustered_at_iso,
    )

    # 2. Firestore docs
    topic_docs = [
        _build_topic_doc(t, uid, pid_to_post, clustered_at)
        for t, uid in zip(topics, topic_uuids)
    ]

    # 3. Execute writes
    bq_written = 0
    if bq_rows:
        for i in range(0, len(bq_rows), 500):
            bq.insert_rows("topic_cluster_members", bq_rows[i : i + 500])
        bq_written = len(bq_rows)
        logger.info("Wrote %d topic-member rows to BQ for agent %s", bq_written, agent_id)

    # Firestore: delete-and-replace (one snapshot per agent)
    topics_ref = (
        fs._db.collection("agents").document(agent_id).collection("topics")
    )
    if delete_existing:
        deleted = 0
        for doc in topics_ref.stream():
            doc.reference.delete()
            deleted += 1
        logger.info("Deleted %d existing topic docs for agent %s", deleted, agent_id)

    for doc, uid in zip(topic_docs, topic_uuids):
        topics_ref.document(uid).set(doc)
    logger.info(
        "Wrote %d topic docs to Firestore for agent %s", len(topic_docs), agent_id,
    )

    # 4. Agent-level metadata
    fs.update_agent(
        agent_id,
        topics_count=len(topics),
        topics_generated_at=clustered_at,
        topics_algorithm_version=ALGORITHM_VERSION,
    )

    return {
        "topics_written": len(topics),
        "bq_rows_written": bq_written,
        "algorithm_version": ALGORITHM_VERSION,
    }


def _build_bq_rows(
    agent_id: str,
    topics: list[Topic],
    topic_uuids: list[str],
    pid_to_post: dict[str, dict],
    clustered_at_iso: str,
) -> list[dict]:
    rows = []
    for t, cluster_uuid in zip(topics, topic_uuids):
        rep_ids = _representative_post_ids(t.member_post_ids, pid_to_post)
        rep_set = set(rep_ids)
        for pid in t.member_post_ids:
            post = pid_to_post.get(pid, {})
            rows.append({
                "cluster_id": cluster_uuid,
                "post_id": pid,
                "agent_id": agent_id,
                "collection_id": post.get("collection_id") or "",
                "distance_to_centroid": None,  # no embeddings in this algorithm
                "is_representative": pid in rep_set,
                "clustered_at": clustered_at_iso,
            })
    return rows


def _build_topic_doc(
    t: Topic,
    cluster_uuid: str,
    pid_to_post: dict[str, dict],
    clustered_at: datetime,
) -> dict[str, Any]:
    rep_ids = _representative_post_ids(t.member_post_ids, pid_to_post)
    member_posts = [pid_to_post.get(pid) or {} for pid in t.member_post_ids]
    return {
        # v1-compat surface (existing UI / queries read these)
        "topic_name": t.header,
        "topic_summary": t.subheader,
        "topic_keywords": list(t.keywords or []),
        "post_count": len(t.member_post_ids),
        "representative_post_ids": rep_ids,
        "recency_score": _recency_score(member_posts, clustered_at),
        "algorithm_version": ALGORITHM_VERSION,
        "created_at": clustered_at,
        # v2 fields
        "header": t.header,
        "subheader": t.subheader,
        "beat_type": getattr(t, "beat_type", None),
        "anchor_entities": list(t.anchor_entities or []),
        "anchor_themes": list(t.anchor_themes or []),
        "anchor_brands": list(t.anchor_brands or []),
        "anchor_content_types": list(t.anchor_content_types or []),
        "member_post_ids": list(t.member_post_ids or []),
        "estimated_pool_count": t.estimated_pool_count,
        "estimated_pool_count_ci_low": t.estimated_pool_count_ci_low,
        "estimated_pool_count_ci_high": t.estimated_pool_count_ci_high,
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
