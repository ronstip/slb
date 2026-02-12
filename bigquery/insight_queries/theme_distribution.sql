SELECT
    theme,
    COUNT(*) AS post_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id,
    UNNEST(ep.themes) AS theme
WHERE p.collection_id = @collection_id
GROUP BY theme
ORDER BY post_count DESC
LIMIT 30;
