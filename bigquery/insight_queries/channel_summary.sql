WITH latest_channels AS (
    SELECT
        ch.channel_handle,
        ch.platform,
        ch.subscribers,
        ch.total_posts AS channel_total_posts,
        ch.channel_url,
        ch.description,
        ROW_NUMBER() OVER (
            PARTITION BY ch.platform, ch.channel_handle
            ORDER BY ch.observed_at DESC
        ) AS rn
    FROM social_listening.channels ch
    WHERE ch.collection_id = @collection_id
),
channel_engagement AS (
    SELECT
        p.channel_handle,
        p.platform,
        COUNT(*) AS collected_posts,
        AVG(COALESCE(e.likes, 0)) AS avg_likes,
        AVG(COALESCE(e.views, 0)) AS avg_views
    FROM social_listening.posts p
    LEFT JOIN (
        SELECT post_id, likes, views,
            ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM social_listening.post_engagements
    ) e ON e.post_id = p.post_id AND e.rn = 1
    WHERE p.collection_id = @collection_id
    GROUP BY p.channel_handle, p.platform
)
SELECT
    lc.channel_handle,
    lc.platform,
    lc.subscribers,
    lc.channel_url,
    ce.collected_posts,
    ROUND(ce.avg_likes, 0) AS avg_likes,
    ROUND(ce.avg_views, 0) AS avg_views
FROM latest_channels lc
JOIN channel_engagement ce
    ON ce.channel_handle = lc.channel_handle AND ce.platform = lc.platform
WHERE lc.rn = 1
ORDER BY ce.collected_posts DESC
LIMIT 20;
