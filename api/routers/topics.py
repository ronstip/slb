"""Topics router — list topics, get analytics, get posts for a topic."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)

router = APIRouter()


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
    """List all topics for a collection (from Firestore)."""
    fs = get_fs()
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

    # Sort by post_count descending
    topics.sort(key=lambda t: t.get("post_count", 0), reverse=True)
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

    # Totals query
    totals = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE collection_id = @collection_id
        ),
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
        JOIN social_listening.posts p ON p.post_id = m.post_id
        LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = m.post_id
        LEFT JOIN social_listening.post_engagements pe ON pe.post_id = m.post_id
        """,
        {"collection_id": collection_id, "cluster_id": cluster_id},
    )

    # Platform breakdown
    platforms = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE collection_id = @collection_id
        ),
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
        JOIN social_listening.posts p ON p.post_id = m.post_id
        LEFT JOIN social_listening.post_engagements pe ON pe.post_id = m.post_id
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
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE collection_id = @collection_id
        ),
        members AS (
            SELECT tcm.post_id, tcm.distance_to_centroid, tcm.is_representative
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.collection_id = @collection_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            p.post_id, p.platform, p.channel_name, p.title, p.content,
            p.post_url, p.posted_at, p.thumbnail_url,
            ep.ai_summary, ep.sentiment, ep.emotion,
            pe.views, pe.likes, pe.comments_count, pe.shares,
            m.distance_to_centroid, m.is_representative
        FROM members m
        JOIN social_listening.posts p ON p.post_id = m.post_id
        LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = m.post_id
        LEFT JOIN social_listening.post_engagements pe ON pe.post_id = m.post_id
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
