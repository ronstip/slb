"""Topic clustering worker — orchestrates the full clustering pipeline.

Flow: fetch embeddings from BQ -> run brothers algorithm -> compute centroids
-> select representatives -> Gemini labeling -> write to BQ + Firestore.
"""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np

from config.settings import get_settings
from workers.clustering.brothers import brothers_cluster
from workers.clustering.labeler import label_topics
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

# Max posts to cluster directly; beyond this, use sampling + two-pass
DIRECT_CLUSTER_LIMIT = 5000
SAMPLE_SIZE = 3000
# Top engagement percentile to always include in sample
TOP_ENGAGEMENT_RATIO = 0.20
MAX_REPRESENTATIVES = 6


def run_clustering(collection_id: str) -> dict[str, Any]:
    """Run the full topic clustering pipeline for a collection.

    Returns a stats dict with topics_count and other metadata.
    """
    settings = get_settings()
    bq = BQClient()
    fs = FirestoreClient()

    # 1. Fetch embeddings + metadata from BQ
    logger.info("Fetching embeddings for collection %s", collection_id)
    rows = bq.query(
        """
        SELECT
            p.post_id,
            pe.embedding,
            p.platform,
            p.title,
            p.content,
            ep.ai_summary,
            COALESCE(eng.views, 0) + COALESCE(eng.likes, 0) * 10
                + COALESCE(eng.comments_count, 0) * 20 AS engagement_score
        FROM social_listening.posts p
        JOIN social_listening.post_embeddings pe ON pe.post_id = p.post_id
        LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
        LEFT JOIN social_listening.post_engagements eng ON eng.post_id = p.post_id
        WHERE p.collection_id = @collection_id
        """,
        {"collection_id": collection_id},
    )

    if len(rows) < 2:
        logger.warning("Collection %s has %d embedded posts — skipping clustering", collection_id, len(rows))
        return {"topics_count": 0, "error": "not enough posts"}

    logger.info("Fetched %d posts with embeddings", len(rows))

    # Parse embeddings into numpy array
    post_ids = [r["post_id"] for r in rows]
    metadata = {r["post_id"]: r for r in rows}
    embeddings = np.array([_parse_embedding(r["embedding"]) for r in rows], dtype=np.float32)

    # 2. Sampling for large collections
    sample_indices = None
    if len(rows) > DIRECT_CLUSTER_LIMIT:
        logger.info("Large collection (%d posts) — sampling %d for clustering", len(rows), SAMPLE_SIZE)
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
        # Remap post_ids to full set
        full_post_ids = post_ids
    else:
        full_post_ids = post_ids

    # 5. Build cluster groups
    n_clusters = int(np.nanmax(cluster_assignments)) + 1 if not np.all(np.isnan(cluster_assignments)) else 0
    cluster_groups: dict[int, list[int]] = {}
    for idx, cid in enumerate(cluster_assignments):
        if not np.isnan(cid):
            cid_int = int(cid)
            cluster_groups.setdefault(cid_int, []).append(idx)

    if not cluster_groups:
        logger.warning("No clusters formed for collection %s", collection_id)
        return {"topics_count": 0, "error": "no clusters formed"}

    logger.info("Formed %d clusters", len(cluster_groups))

    # 6. Compute centroids and select representatives
    cluster_ids: dict[int, str] = {}  # cluster_index -> uuid
    centroids: dict[int, np.ndarray] = {}
    clusters_for_labeling: list[dict[str, Any]] = []

    for cid, member_indices in sorted(cluster_groups.items()):
        cluster_uuid = str(uuid.uuid4())
        cluster_ids[cid] = cluster_uuid

        # Centroid
        member_embeddings = embeddings[member_indices]
        centroids[cid] = member_embeddings.mean(axis=0)

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

    # 8. Write to BQ (versioned by clustered_at)
    clustered_at = datetime.now(timezone.utc).isoformat()
    bq_rows = []
    for cid, member_indices in cluster_groups.items():
        cluster_uuid = cluster_ids[cid]
        centroid = centroids[cid]

        # Mark representatives
        member_posts = [(i, metadata[full_post_ids[i]]) for i in member_indices]
        member_posts.sort(key=lambda x: x[1].get("engagement_score", 0), reverse=True)
        rep_indices = {member_posts[j][0] for j in range(min(MAX_REPRESENTATIVES, len(member_posts)))}

        for idx in member_indices:
            emb = embeddings[idx]
            dist = float(np.dot(emb - centroid, emb - centroid) ** 0.5)
            bq_rows.append({
                "cluster_id": cluster_uuid,
                "post_id": full_post_ids[idx],
                "collection_id": collection_id,
                "distance_to_centroid": round(dist, 6),
                "is_representative": idx in rep_indices,
                "clustered_at": clustered_at,
            })

    logger.info("Inserting %d membership rows into BQ", len(bq_rows))
    # Insert in batches of 500
    for i in range(0, len(bq_rows), 500):
        bq.insert_rows("topic_cluster_members", bq_rows[i : i + 500])

    # 9. Write to Firestore — delete old topics, write new ones
    _write_firestore_topics(
        fs, collection_id, cluster_groups, cluster_ids, centroids,
        label_map, full_post_ids, metadata, clustered_at,
    )

    # 10. Update collection status
    fs.update_collection_status(
        collection_id,
        topics_count=len(cluster_groups),
        topics_generated_at=datetime.now(timezone.utc),
    )

    result = {
        "topics_count": len(cluster_groups),
        "total_posts": len(full_post_ids),
        "clustered_posts": sum(len(m) for m in cluster_groups.values()),
        "ungrouped_posts": int(np.isnan(cluster_assignments).sum()),
    }
    logger.info("Clustering complete for %s: %s", collection_id, result)
    return result


def _parse_embedding(value: Any) -> list[float]:
    """Parse an embedding from BQ — may be a list, string, or struct."""
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


def _write_firestore_topics(
    fs: FirestoreClient,
    collection_id: str,
    cluster_groups: dict[int, list[int]],
    cluster_ids: dict[int, str],
    centroids: dict[int, np.ndarray],
    label_map: dict[int, dict],
    post_ids: list[str],
    metadata: dict[str, dict],
    clustered_at: str,
) -> None:
    """Delete old topic docs and write new ones to Firestore subcollection."""
    db = fs._db
    topics_ref = (
        db.collection("collection_status")
        .document(collection_id)
        .collection("topics")
    )

    # Delete existing topics
    existing = topics_ref.stream()
    for doc in existing:
        doc.reference.delete()

    # Write new topics
    for cid, member_indices in sorted(cluster_groups.items()):
        cluster_uuid = cluster_ids[cid]
        label = label_map.get(cid, {})

        # Representative post IDs
        member_posts = [(i, metadata[post_ids[i]]) for i in member_indices]
        member_posts.sort(key=lambda x: x[1].get("engagement_score", 0), reverse=True)
        rep_post_ids = [post_ids[member_posts[j][0]] for j in range(min(MAX_REPRESENTATIVES, len(member_posts)))]

        topic_doc = {
            "topic_name": label.get("topic_name", f"Topic {cid + 1}"),
            "topic_summary": label.get("topic_summary", ""),
            "topic_keywords": label.get("topic_keywords", []),
            "post_count": len(member_indices),
            "representative_post_ids": rep_post_ids,
            "centroid": centroids[cid].tolist(),
            "algorithm_version": "brothers_v1",
            "created_at": datetime.now(timezone.utc),
        }

        topics_ref.document(cluster_uuid).set(topic_doc)

    logger.info("Wrote %d topic docs to Firestore for %s", len(cluster_groups), collection_id)
