import json
import logging

from api.deps import get_bq

logger = logging.getLogger(__name__)

MAX_POSTS = 10


def display_posts(post_ids: list[str], collection_id: str = "") -> dict:
    """Display social media posts as rich embedded cards in the conversation.

    Call this after execute_sql when you want to show specific posts visually.
    Pass the post_ids from your query results. The tool fetches full post data
    (engagement, enrichment, media) from the database.

    Args:
        post_ids: List of post IDs to display (max 10).
        collection_id: Optional collection ID for context.

    Returns:
        A dictionary with status and posts list containing full post data.
    """
    if not post_ids:
        return {"status": "error", "message": "No post_ids provided.", "posts": []}

    # Cap at MAX_POSTS
    post_ids = post_ids[:MAX_POSTS]

    bq = get_bq()

    # Build parameterized query for the given post IDs
    placeholders = ", ".join(f"@pid{i}" for i in range(len(post_ids)))
    params = {f"pid{i}": pid for i, pid in enumerate(post_ids)}

    query = f"""
    SELECT
        p.post_id,
        p.collection_id,
        p.platform,
        p.channel_handle,
        p.channel_id,
        p.title,
        p.content,
        p.post_url,
        p.posted_at,
        p.post_type,
        p.media_refs,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) as total_engagement,
        ep.sentiment,
        ep.themes,
        ep.entities,
        ep.ai_summary,
        ep.content_type
    FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
        WHERE post_id IN ({placeholders})
    ) p
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    WHERE p._rn = 1
    """

    try:
        rows = bq.query(query, params)
    except Exception as e:
        logger.exception("display_posts query failed")
        return {"status": "error", "message": f"Failed to fetch posts: {e}", "posts": []}

    if not rows:
        return {
            "status": "success",
            "message": "No posts found for the given IDs.",
            "posts": [],
            "count": 0,
        }

    posts = []
    for row in rows:
        # Parse JSON fields
        media_refs = row.get("media_refs")
        if isinstance(media_refs, str):
            try:
                media_refs = json.loads(media_refs)
            except (json.JSONDecodeError, TypeError):
                media_refs = []

        themes = row.get("themes")
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except (json.JSONDecodeError, TypeError):
                themes = []

        entities = row.get("entities")
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except (json.JSONDecodeError, TypeError):
                entities = []

        posts.append({
            "post_id": row["post_id"],
            "collection_id": row.get("collection_id", collection_id),
            "platform": row["platform"],
            "channel_handle": row.get("channel_handle", ""),
            "channel_id": row.get("channel_id"),
            "title": row.get("title"),
            "content": row.get("content"),
            "post_url": row.get("post_url", ""),
            "posted_at": str(row.get("posted_at", "")),
            "post_type": row.get("post_type", ""),
            "media_refs": media_refs if isinstance(media_refs, list) else [],
            "likes": row.get("likes", 0),
            "shares": row.get("shares", 0),
            "views": row.get("views", 0),
            "comments_count": row.get("comments_count", 0),
            "saves": row.get("saves", 0),
            "total_engagement": row.get("total_engagement", 0),
            "sentiment": row.get("sentiment"),
            "themes": themes if isinstance(themes, list) else [],
            "entities": entities if isinstance(entities, list) else [],
            "ai_summary": row.get("ai_summary"),
            "content_type": row.get("content_type"),
        })

    return {
        "status": "success",
        "posts": posts,
        "count": len(posts),
    }
