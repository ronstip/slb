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
    p.platform,
    COUNT(*) AS total_posts,
    SUM(COALESCE(e.likes, 0)) AS total_likes,
    SUM(COALESCE(e.shares, 0)) AS total_shares,
    SUM(COALESCE(e.views, 0)) AS total_views,
    SUM(COALESCE(e.comments_count, 0)) AS total_comments,
    ROUND(AVG(COALESCE(e.likes, 0)), 0) AS avg_likes,
    ROUND(AVG(COALESCE(e.views, 0)), 0) AS avg_views,
    MAX(COALESCE(e.likes, 0)) AS max_likes,
    MAX(COALESCE(e.views, 0)) AS max_views
FROM social_listening.posts p
LEFT JOIN latest_engagement e ON e.post_id = p.post_id AND e.rn = 1
WHERE p.collection_id = @collection_id
GROUP BY p.platform
ORDER BY total_posts DESC;
