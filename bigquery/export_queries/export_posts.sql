WITH latest_engagement AS (
    SELECT
        post_id,
        likes,
        shares,
        views,
        comments_count,
        saves,
        ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
)
SELECT
    p.post_id,
    p.platform,
    p.channel_handle,
    p.title,
    p.content,
    p.post_url,
    p.posted_at,
    p.post_type,
    e.likes,
    e.shares,
    e.views,
    e.comments_count,
    e.saves,
    COALESCE(e.likes, 0) + COALESCE(e.shares, 0) + COALESCE(e.views, 0) AS total_engagement,
    ep.sentiment,
    ep.themes,
    ep.entities,
    ep.ai_summary,
    ep.content_type
FROM social_listening.posts p
LEFT JOIN latest_engagement e ON e.post_id = p.post_id AND e.rn = 1
LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id
ORDER BY p.posted_at DESC;
