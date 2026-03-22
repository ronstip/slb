"""Topics router — list topics, get analytics, get posts for a topic."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared CTE fragment for latest clustering run
_LATEST_CTE = """
    WITH latest AS (
        SELECT MAX(clustered_at) as latest_at
        FROM social_listening.topic_cluster_members
        WHERE collection_id = @collection_id
    )"""

# Deduplication subqueries matching the feed endpoint pattern (main.py:1241-1254)
_POSTS_DEDUP = """(
        SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p ON p.post_id = m.post_id AND p._rn = 1"""

_ENRICHED_DEDUP = """(
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON ep.post_id = m.post_id AND ep._rn = 1"""

_ENGAGEMENTS_DEDUP = """(
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON pe.post_id = m.post_id AND pe.rn = 1"""


def _check_collection_access(fs, user: CurrentUser, collection_id: str) -> dict:
    """Validate collection exists and user has access. Returns collection status."""
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(404, "Collection not found")
    # Owner or org member with org visibility
    if status.get("user_id") == user.uid:
        return status
    if (
        user.org_id
        and status.get("org_id") == user.org_id
        and status.get("visibility") == "org"
    ):
        return status
    raise HTTPException(403, "Access denied")


@router.get("/collections/{collection_id}/topics")
async def list_topics(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """List all topics for a collection (from Firestore + BQ summary metrics)."""
    fs = get_fs()
    bq = get_bq()
    _check_collection_access(fs, user, collection_id)

    topics_ref = (
        fs._db.collection("collection_status")
        .document(collection_id)
        .collection("topics")
    )

    topics = []
    for doc in topics_ref.stream():
        data = doc.to_dict()
        data["cluster_id"] = doc.id
        # Convert timestamps
        if "created_at" in data and hasattr(data["created_at"], "isoformat"):
            data["created_at"] = data["created_at"].isoformat()
        # Don't send centroid to frontend (768 floats)
        data.pop("centroid", None)
        topics.append(data)

    if not topics:
        return topics

    # Batch BQ query: per-cluster sentiment + engagement summary
    summary_rows = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            m.cluster_id,
            COUNTIF(ep.sentiment = 'positive') as positive_count,
            COUNTIF(ep.sentiment = 'negative') as negative_count,
            COUNTIF(ep.sentiment = 'neutral') as neutral_count,
            COUNTIF(ep.sentiment = 'mixed') as mixed_count,
            SUM(COALESCE(pe.views, 0)) as total_views,
            SUM(COALESCE(pe.likes, 0)) as total_likes
        FROM members m
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        GROUP BY m.cluster_id
        """,
        {"collection_id": collection_id},
    )
    summary_map = {r["cluster_id"]: r for r in summary_rows}

    # Thumbnail query: best representative post image per cluster
    thumb_rows = bq.query(
        f"""
        {_LATEST_CTE},
        rep_members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.clustered_at = latest.latest_at
              AND tcm.is_representative = TRUE
        ),
        ranked AS (
            SELECT m.cluster_id, p.media_refs,
                   ROW_NUMBER() OVER (PARTITION BY m.cluster_id ORDER BY COALESCE(pe.views, 0) DESC) as rn
            FROM rep_members m
            JOIN {_POSTS_DEDUP}
            LEFT JOIN {_ENGAGEMENTS_DEDUP}
            WHERE p.media_refs IS NOT NULL
        )
        SELECT cluster_id,
               JSON_EXTRACT_SCALAR(media_refs, '$[0].original_url') as thumbnail_url,
               JSON_EXTRACT_SCALAR(media_refs, '$[0].gcs_uri') as thumbnail_gcs_uri
        FROM ranked
        WHERE rn = 1
          AND JSON_EXTRACT_SCALAR(media_refs, '$[0].original_url') IS NOT NULL
        """,
        {"collection_id": collection_id},
    )
    thumb_map = {r["cluster_id"]: r for r in thumb_rows}

    # Merge BQ data into Firestore topics
    for topic in topics:
        cid = topic["cluster_id"]
        if cid in summary_map:
            s = summary_map[cid]
            topic["positive_count"] = s["positive_count"]
            topic["negative_count"] = s["negative_count"]
            topic["neutral_count"] = s["neutral_count"]
            topic["mixed_count"] = s["mixed_count"]
            topic["total_views"] = s["total_views"]
            topic["total_likes"] = s["total_likes"]
        if cid in thumb_map:
            topic["thumbnail_url"] = thumb_map[cid].get("thumbnail_url")
            topic["thumbnail_gcs_uri"] = thumb_map[cid].get("thumbnail_gcs_uri")

    # Sort: real topic names first (by post_count desc), then generic "Topic N" names last
    import re
    def _sort_key(t):
        name = t.get("topic_name", "")
        is_generic = bool(re.match(r"^Topic \d+$", name))
        return (is_generic, -t.get("post_count", 0))

    topics.sort(key=_sort_key)
    return topics


@router.get("/topics/{cluster_id}/analytics")
async def get_topic_analytics(
    cluster_id: str,
    collection_id: str = Query(...),
    user: CurrentUser = Depends(get_current_user),
):
    """On-demand analytics for a topic — sentiment, platform, engagement distributions."""
    fs = get_fs()
    bq = get_bq()
    _check_collection_access(fs, user, collection_id)

    # Totals query (with dedup JOINs to prevent inflated counts)
    totals = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            COUNT(*) as post_count,
            COUNTIF(ep.sentiment = 'positive') as positive_count,
            COUNTIF(ep.sentiment = 'negative') as negative_count,
            COUNTIF(ep.sentiment = 'neutral') as neutral_count,
            COUNTIF(ep.sentiment = 'mixed') as mixed_count,
            SUM(COALESCE(pe.views, 0)) as total_views,
            SUM(COALESCE(pe.likes, 0)) as total_likes,
            SUM(COALESCE(pe.comments_count, 0)) as total_comments,
            MIN(p.posted_at) as earliest_post,
            MAX(p.posted_at) as latest_post
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        """,
        {"collection_id": collection_id, "cluster_id": cluster_id},
    )

    # Platform breakdown (with dedup JOINs)
    platforms = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            p.platform,
            COUNT(*) as post_count,
            SUM(COALESCE(pe.views, 0)) as views,
            SUM(COALESCE(pe.likes, 0)) as likes
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        GROUP BY p.platform
        """,
        {"collection_id": collection_id, "cluster_id": cluster_id},
    )

    return {
        "totals": totals[0] if totals else {},
        "platforms": platforms,
    }


@router.get("/topics/{cluster_id}/posts")
async def get_topic_posts(
    cluster_id: str,
    collection_id: str = Query(...),
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_user),
):
    """Paginated posts within a topic."""
    fs = get_fs()
    bq = get_bq()
    _check_collection_access(fs, user, collection_id)

    posts = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id, tcm.distance_to_centroid, tcm.is_representative
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            p.post_id, p.platform, p.channel_handle as channel_name, p.title, p.content,
            p.post_url, p.posted_at, p.media_refs,
            JSON_EXTRACT_SCALAR(p.media_refs, '$[0].original_url') as thumbnail_url,
            JSON_EXTRACT_SCALAR(p.media_refs, '$[0].gcs_uri') as thumbnail_gcs_uri,
            ep.ai_summary, ep.sentiment, ep.emotion,
            pe.views, pe.likes, pe.comments_count, pe.shares,
            m.distance_to_centroid, m.is_representative
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        ORDER BY m.is_representative DESC, COALESCE(pe.views, 0) + COALESCE(pe.likes, 0) * 10 DESC
        LIMIT @limit OFFSET @offset
        """,
        {
            "collection_id": collection_id,
            "cluster_id": cluster_id,
            "limit": limit,
            "offset": offset,
        },
    )

    return posts
