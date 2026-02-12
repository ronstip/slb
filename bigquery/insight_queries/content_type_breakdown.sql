SELECT
    ep.content_type,
    COUNT(*) AS count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id
  AND ep.content_type IS NOT NULL
GROUP BY ep.content_type
ORDER BY count DESC;
