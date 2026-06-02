"""Topic clustering worker - orchestrates the full clustering pipeline.

Flow: fetch embeddings from BQ -> run brothers algorithm -> compute centroids
-> select representatives -> Gemini labeling -> write to BQ + Firestore.

Scope: agent-wide - clusters ALL relevant posts across all agent collections,
filtered to is_related_to_task=TRUE and posted within the last 30 days.
"""

import logging
import math
import re
import statistics
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from config.settings import get_settings
from workers.clustering.brothers import brothers_cluster
from workers.clustering.labeler import label_topics
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.sql_dedup import DEDUP_EMBEDDINGS

ALGORITHM_VERSION = "brothers_v1"

_SQL_DIR = Path(__file__).resolve().parent.parent.parent / "bigquery"


def _load_underlying_data_ctes() -> str:
    """Load the CTE definitions from underlying_data.sql (everything up to the
    final SELECT).  Strips the @created_at anchor so the query returns current
    data rather than a frozen snapshot.

    Returns the WITH ... clause (without trailing comma) ready to have extra
    CTEs appended via ", <extra_cte>".
    """
    raw = (_SQL_DIR / "export_queries" / "underlying_data.sql").read_text()
    # Remove @created_at timestamp filters
    sql = raw.replace("AND p.collected_at <= @created_at", "")
    sql = sql.replace("AND collected_at <= @created_at", "")
    sql = sql.replace("WHERE enriched_at <= @created_at", "")
    sql = sql.replace("WHERE fetched_at <= @created_at", "")
    # Extract just the WITH ... CTEs block (everything before the final SELECT)
    match = re.split(r"\nSELECT\b", sql, maxsplit=1, flags=re.IGNORECASE)
    if len(match) < 2:
        raise ValueError("Could not parse CTEs from underlying_data.sql")
    ctes = match[0].strip().rstrip(",")
    return ctes

logger = logging.getLogger(__name__)

# Max posts to cluster directly; beyond this, use sampling + two-pass
DIRECT_CLUSTER_LIMIT = 5000
SAMPLE_SIZE = 3000
# Top engagement percentile to always include in sample
TOP_ENGAGEMENT_RATIO = 0.20
MAX_REPRESENTATIVES = 6

# Recency score: exponential decay with 7-day half-life
HALF_LIFE_DAYS = 7.0
_LAMBDA = math.log(2) / HALF_LIFE_DAYS


def run_clustering(agent_id: str, collection_ids: list[str]) -> dict[str, Any]:
    """Run the full topic clustering pipeline across all agent collections.

    Clusters only posts that are relevant (is_related_to_task=TRUE) and
    published within the last 30 days.

    Returns a stats dict with topics_count and other metadata.
    """
    settings = get_settings()
    bq = BQClient()
    fs = FirestoreClient()

    if not collection_ids:
        logger.warning("No collection_ids for agent %s - skipping clustering", agent_id)
        return {"topics_count": 0, "error": "no collections"}

    # 1. Fetch embeddings + metadata from BQ (agent-wide, progressive fallback).
    #
    # Tiers widen the net until we find ≥2 posts to cluster. Without this
    # fallback, agents whose enrichment marked few/no posts as relevant would
    # silently produce zero topics.
    logger.info("Fetching embeddings for agent %s (%d collections)", agent_id, len(collection_ids))
    rows = _fetch_posts_with_fallback(bq, agent_id, collection_ids)

    if len(rows) < 2:
        logger.warning("Agent %s has %d eligible posts across all tiers - skipping clustering", agent_id, len(rows))
        return {"topics_count": 0, "error": "not enough posts"}

    logger.info("Fetched %d posts with embeddings", len(rows))

    # Parse embeddings into numpy array
    post_ids = [r["post_id"] for r in rows]
    metadata = {r["post_id"]: r for r in rows}
    embeddings = np.array([_parse_embedding(r["embedding"]) for r in rows], dtype=np.float32)

    # 2. Sampling for large datasets
    sample_indices = None
    if len(rows) > DIRECT_CLUSTER_LIMIT:
        logger.info("Large dataset (%d posts) - sampling %d for clustering", len(rows), SAMPLE_SIZE)
        sample_indices = _sample_indices(rows, SAMPLE_SIZE)
        sample_embeddings = embeddings[sample_indices]
    else:
        sample_embeddings = embeddings

    # 3. Run brothers algorithm
    logger.info("Running brothers algorithm on %d posts", len(sample_embeddings))
    cluster_assignments, stats = brothers_cluster(
        sample_embeddings,
        brothers_threshold=settings.clustering_brothers_threshold,
        max_intra_group_mean=settings.clustering_max_intra_group_mean,
        max_distance_for_ungrouped=settings.clustering_max_distance_ungrouped,
    )
    logger.info("Brothers stats: %s", stats)

    # 4. If sampled, assign remaining posts to nearest centroid
    if sample_indices is not None:
        cluster_assignments = _two_pass_assign(
            embeddings, sample_indices, cluster_assignments,
        )
        full_post_ids = post_ids
    else:
        full_post_ids = post_ids

    # 5. Build cluster groups
    cluster_groups: dict[int, list[int]] = {}
    for idx, cid in enumerate(cluster_assignments):
        if not np.isnan(cid):
            cid_int = int(cid)
            cluster_groups.setdefault(cid_int, []).append(idx)

    if not cluster_groups:
        logger.warning("No clusters formed for agent %s", agent_id)
        return {"topics_count": 0, "error": "no clusters formed"}

    logger.info("Formed %d clusters", len(cluster_groups))

    # 6. Recency scores, and select representatives. (Centroids used to be
    # persisted to Firestore for similarity lookups; nothing reads them now,
    # so the computation was dropped along with the Firestore write.)
    now = datetime.now(timezone.utc)
    cluster_ids: dict[int, str] = {}  # cluster_index -> uuid
    recency_scores: dict[int, float] = {}
    clusters_for_labeling: list[dict[str, Any]] = []

    for cid, member_indices in sorted(cluster_groups.items()):
        cluster_uuid = str(uuid.uuid4())
        cluster_ids[cid] = cluster_uuid

        # Recency score
        recency_scores[cid] = _compute_recency_score(member_indices, full_post_ids, metadata, now)

        # Select representatives: top by engagement score
        member_posts = [(i, metadata[full_post_ids[i]]) for i in member_indices]
        member_posts.sort(key=lambda x: x[1].get("engagement_score", 0), reverse=True)
        representatives = member_posts[:MAX_REPRESENTATIVES]

        clusters_for_labeling.append({
            "cluster_index": cid,
            "posts": [
                {
                    "platform": r[1].get("platform", ""),
                    "title": r[1].get("title", ""),
                    "ai_summary": r[1].get("ai_summary", ""),
                    "content": r[1].get("content", ""),
                }
                for r in representatives
            ],
        })

    # 7. Gemini labeling
    logger.info("Labeling %d topics with Gemini", len(clusters_for_labeling))
    labels = label_topics(clusters_for_labeling)
    label_map = {l["cluster_index"]: l for l in labels}

    # 8. Write one row per cluster to topic_clusters (denormalised membership).
    # brothers_v1 operates on the full pool (with two-pass assignment for the
    # >5K case), so estimated_* equals real values: factor = 1.0.
    clustered_at_dt = datetime.now(timezone.utc)
    clustered_at = clustered_at_dt.isoformat()
    cluster_rows = [
        _build_brothers_cluster_row(
            agent_id=agent_id,
            cluster_uuid=cluster_ids[cid],
            member_indices=member_indices,
            full_post_ids=full_post_ids,
            metadata=metadata,
            label=label_map.get(cid, {}),
            recency_score=recency_scores[cid],
            clustered_at_dt=clustered_at_dt,
            clustered_at_iso=clustered_at,
        )
        for cid, member_indices in cluster_groups.items()
    ]

    logger.info("Inserting %d topic_clusters rows into BQ", len(cluster_rows))
    for i in range(0, len(cluster_rows), 500):
        bq.insert_rows("topic_clusters", cluster_rows[i : i + 500])

    # 9. Update agent status. The `topics/` Firestore subcollection used to
    # mirror each cluster doc here; readers now use `topic_metrics(@agent_id)`
    # so we only update the agent-level summary fields.
    fs.update_agent(
        agent_id,
        topics_count=len(cluster_groups),
        topics_generated_at=datetime.now(timezone.utc),
    )

    result = {
        "topics_count": len(cluster_groups),
        "total_posts": len(full_post_ids),
        "clustered_posts": sum(len(m) for m in cluster_groups.values()),
        "ungrouped_posts": int(np.isnan(cluster_assignments).sum()),
    }
    logger.info("Clustering complete for agent %s: %s", agent_id, result)
    return result


def _build_brothers_cluster_row(
    agent_id: str,
    cluster_uuid: str,
    member_indices: list[int],
    full_post_ids: list[str],
    metadata: dict[str, dict],
    label: dict,
    recency_score: float,
    clustered_at_dt: datetime,
    clustered_at_iso: str,
) -> dict[str, Any]:
    """Build one topic_clusters row for a brothers_v1 cluster.

    Same row shape as the v2 writer's `_build_topic_cluster_row`. brothers_v1
    has no LLM-derived definition fields (header/subheader/beat_type/anchors)
    so those go in as None / empty arrays. extrapolated_* equals real_* because
    brothers_v1 clusters the full pool (factor = 1.0).
    """
    member_posts = [metadata[full_post_ids[i]] for i in member_indices]
    member_post_ids = [full_post_ids[i] for i in member_indices]

    # Representatives: top-K by engagement_score (already pre-computed on each
    # metadata dict). Same as the inline logic in the previous BQ write.
    sorted_members = sorted(
        zip(member_indices, member_posts),
        key=lambda x: x[1].get("engagement_score", 0),
        reverse=True,
    )
    rep_post_ids = [
        full_post_ids[idx] for idx, _ in sorted_members[:MAX_REPRESENTATIVES]
    ]
    post_count = len(member_indices)

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

    return {
        "agent_id": agent_id,
        "cluster_id": cluster_uuid,
        "clustered_at": clustered_at_iso,
        "algorithm_version": ALGORITHM_VERSION,
        # definition - brothers_v1 only has labeler output, no anchors
        "header": label.get("topic_name"),
        "subheader": label.get("topic_summary"),
        "beat_type": None,
        "keywords": list(label.get("topic_keywords") or []),
        "anchor_entities": [],
        "anchor_themes": [],
        "anchor_brands": [],
        "anchor_content_types": [],
        # membership
        "member_post_ids": member_post_ids,
        "representative_post_ids": rep_post_ids,
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
        # brothers_v1 clusters the full pool - extrapolated equals real.
        "estimated_post_count": post_count,
        "estimated_views": total_views,
        "estimated_likes": total_likes,
        "estimated_comments": total_comments,
        "estimated_shares": total_shares,
        "recency_score": recency_score,
    }


def _post_time_stats(
    member_posts: list[dict],
) -> tuple[datetime | None, datetime | None, datetime | None]:
    """Returns (earliest, median, latest) posted_at. median_low avoids
    averaging datetimes - fine for "where is the mass" semantics.
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


def _build_embeddings_query(
    enriched_join: str,
    posted_at_filter: str,
) -> str:
    """Build the embeddings fetch query with the given join/filter clauses."""
    return f"""
        {_load_underlying_data_ctes()},
        {DEDUP_EMBEDDINGS}
        SELECT
            p.post_id,
            pe.embedding,
            p.platform,
            p.title,
            p.content,
            p.collection_id,
            p.posted_at,
            ep.ai_summary,
            ep.sentiment,
            COALESCE(eng.views, 0) AS views,
            COALESCE(eng.likes, 0) AS likes,
            COALESCE(eng.comments_count, 0) AS comments_count,
            COALESCE(eng.shares, 0) AS shares,
            COALESCE(eng.views, 0) + COALESCE(eng.likes, 0) * 10
                + COALESCE(eng.comments_count, 0) * 20 AS engagement_score
        FROM deduped_posts p
        JOIN deduped_embeddings pe ON pe.post_id = p.post_id AND pe._rn = 1
        {enriched_join}
        LEFT JOIN deduped_engagements eng ON eng.post_id = p.post_id AND eng._rn = 1
        WHERE p._rn = 1
          {posted_at_filter}
        """


def _fetch_posts_with_fallback(
    bq: BQClient, agent_id: str, collection_ids: list[str]
) -> list[dict[str, Any]]:
    """Try progressively looser queries until we have ≥2 posts to cluster.

    Tier 1: relevant (is_related_to_task=TRUE) + last 30 days  (ideal)
    Tier 2: relevant-or-unknown (TRUE or NULL)   + last 30 days
    Tier 3: any enrichment state                  + last 30 days
    Tier 4: any enrichment state                  + no time window
    """
    window_30d = "AND p.posted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)"
    join_relevant = (
        "JOIN deduped_enriched ep ON ep.post_id = p.post_id AND ep._rn = 1 "
        "AND ep.is_related_to_task = TRUE"
    )
    join_relevant_or_null = (
        "LEFT JOIN deduped_enriched ep ON ep.post_id = p.post_id AND ep._rn = 1 "
        "AND (ep.is_related_to_task = TRUE OR ep.is_related_to_task IS NULL)"
    )
    join_any = "LEFT JOIN deduped_enriched ep ON ep.post_id = p.post_id AND ep._rn = 1"

    tiers = [
        (1, join_relevant, window_30d),
        (2, join_relevant_or_null, window_30d),
        (3, join_any, window_30d),
        (4, join_any, ""),
    ]

    for tier, enriched_join, posted_at_filter in tiers:
        sql = _build_embeddings_query(enriched_join, posted_at_filter)
        rows = bq.query(sql, {"collection_ids": collection_ids})
        logger.info("Clustering tier=%d produced %d rows for agent %s", tier, len(rows), agent_id)
        if len(rows) >= 2:
            return rows

    return []


def _compute_recency_score(
    member_indices: list[int],
    post_ids: list[str],
    metadata: dict[str, dict],
    now: datetime,
) -> float:
    """Compute exponential-decay recency score for a cluster.

    Each post contributes exp(-lambda * age_days).  Half-life = 7 days.
    """
    score = 0.0
    for idx in member_indices:
        posted_at = metadata[post_ids[idx]].get("posted_at")
        if posted_at:
            if isinstance(posted_at, str):
                posted_at = datetime.fromisoformat(posted_at)
            if posted_at.tzinfo is None:
                posted_at = posted_at.replace(tzinfo=timezone.utc)
            age_days = (now - posted_at).total_seconds() / 86400
            score += math.exp(-_LAMBDA * max(age_days, 0))
    return round(score, 4)


def _parse_embedding(value: Any) -> list[float]:
    """Parse an embedding from BQ - may be a list, string, or struct."""
    if isinstance(value, (list, np.ndarray)):
        return [float(x) for x in value]
    if isinstance(value, str):
        import json
        return json.loads(value)
    # BQ STRUCT with 'values' field
    if hasattr(value, "get"):
        return [float(x) for x in value.get("values", value)]
    return list(value)


def _sample_indices(rows: list[dict], sample_size: int) -> np.ndarray:
    """Sample indices: top engagement + random fill."""
    n = len(rows)
    scores = np.array([r.get("engagement_score", 0) for r in rows])

    # Top engagement
    top_k = int(n * TOP_ENGAGEMENT_RATIO)
    top_indices = set(np.argsort(scores)[-top_k:].tolist())

    # Random fill
    remaining = list(set(range(n)) - top_indices)
    fill_count = min(sample_size - len(top_indices), len(remaining))
    if fill_count > 0:
        rng = np.random.default_rng(42)
        random_indices = set(rng.choice(remaining, size=fill_count, replace=False).tolist())
    else:
        random_indices = set()

    all_indices = sorted(top_indices | random_indices)
    return np.array(all_indices)


def _two_pass_assign(
    all_embeddings: np.ndarray,
    sample_indices: np.ndarray,
    sample_assignments: np.ndarray,
) -> np.ndarray:
    """Assign non-sampled posts to nearest cluster centroid."""
    from scipy.spatial.distance import cdist

    # Compute centroids from sample
    n_clusters = int(np.nanmax(sample_assignments)) + 1 if not np.all(np.isnan(sample_assignments)) else 0
    centroids = {}
    for cid in range(n_clusters):
        mask = sample_assignments == cid
        if mask.any():
            centroids[cid] = all_embeddings[sample_indices[mask]].mean(axis=0)

    if not centroids:
        return np.full(len(all_embeddings), np.nan)

    centroid_matrix = np.array([centroids[i] for i in sorted(centroids.keys())])
    centroid_ids = sorted(centroids.keys())

    # Full assignment array
    full_assignments = np.full(len(all_embeddings), np.nan)

    # Copy sample assignments
    for si, sa in zip(sample_indices, sample_assignments):
        full_assignments[si] = sa

    # Assign remaining
    sample_set = set(sample_indices.tolist())
    remaining = [i for i in range(len(all_embeddings)) if i not in sample_set]
    if remaining:
        remaining_embeddings = all_embeddings[remaining]
        dists = cdist(remaining_embeddings, centroid_matrix, metric="cosine")
        nearest = dists.argmin(axis=1)
        for ri, ni in zip(remaining, nearest):
            full_assignments[ri] = centroid_ids[ni]

    return full_assignments


