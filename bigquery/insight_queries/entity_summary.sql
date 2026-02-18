WITH entity_posts AS (
    SELECT
        entity,
        p.post_id,
        COALESCE(e.likes, 0) AS likes,
        COALESCE(e.views, 0) AS views
    FROM social_listening.posts p
    JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id,
        UNNEST(ep.entities) AS entity
    LEFT JOIN (
        SELECT post_id, likes, views,
            ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM social_listening.post_engagements
    ) e ON e.post_id = p.post_id AND e.rn = 1
    WHERE p.collection_id = @collection_id
)
SELECT
    entity,
    COUNT(DISTINCT post_id) AS mentions,
    SUM(views) AS total_views,
    SUM(likes) AS total_likes
FROM entity_posts
GROUP BY entity
ORDER BY mentions DESC
LIMIT 20;
