import json
import logging

from api.deps import get_bq

logger = logging.getLogger(__name__)

MAX_POSTS = 10


def display_posts(
    post_ids: list[str] = None,
    collection_ids: list[str] = None,
    collection_id: str = "",
    sort_by: str = "engagement",
    limit: int = 10,
) -> dict:
    """Display social media posts as rich embedded cards in the conversation.

    WHEN TO USE: To SHOW specific posts to the user — after identifying
    interesting ones via SQL, or to show collection highlights.
    WHEN NOT TO USE: To analyze posts — query them with SQL first, then
    display the interesting ones. Don't paste post content as text.

    Two modes:
    1. **By post_ids** — Pass specific post IDs from your query results.
    2. **By collection_ids** — Fetch top posts sorted by engagement.

    Args:
        post_ids: List of specific post IDs to display (max 10).
        collection_ids: List of collection IDs to fetch top posts from.
            Used when post_ids is empty. Preferred over collection_id.
        collection_id: Single collection ID (deprecated — use collection_ids).
        sort_by: Sort order when fetching by collection. Default "engagement".
        limit: Max posts to return when fetching by collection. Default 10.

    Returns:
        A dictionary with status and posts list containing full post data.
    """
    # Normalize collection_ids
    coll_ids = collection_ids or ([collection_id] if collection_id else [])

    if not post_ids and not coll_ids:
        return {"status": "error", "message": "Provide either post_ids or collection_ids.", "posts": []}

    bq = get_bq()

    # ── Mode 2: fetch top posts from collection(s) by engagement ──
    if not post_ids and coll_ids:
        limit = min(limit, MAX_POSTS)
        coll_query = """
        SELECT p.post_id
        FROM social_listening.posts p
        LEFT JOIN (
            SELECT post_id, likes, views, comments_count,
                   ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
            FROM social_listening.post_engagements
        ) pe ON p.post_id = pe.post_id AND pe.rn = 1
        WHERE p.collection_id IN UNNEST(@collection_ids)
        ORDER BY COALESCE(pe.likes, 0) + COALESCE(pe.views, 0) + COALESCE(pe.comments_count, 0) DESC
        LIMIT @limit
        """
        try:
            id_rows = bq.query(coll_query, {"collection_ids": coll_ids, "limit": limit})
        except Exception as e:
            logger.exception("display_posts collection query failed")
            return {"status": "error", "message": f"Failed to fetch posts: {e}", "posts": []}

        post_ids = [r["post_id"] for r in id_rows]
        if not post_ids:
            return {"status": "success", "message": "No posts found in the given collection(s).", "posts": [], "count": 0}

    # Cap at MAX_POSTS
    post_ids = post_ids[:MAX_POSTS]

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
        ep.emotion,
        ep.themes,
        ep.entities,
        ep.ai_summary,
        ep.content_type,
        ep.key_quotes,
        ep.custom_fields
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
            "collection_id": row.get("collection_id", ""),
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
