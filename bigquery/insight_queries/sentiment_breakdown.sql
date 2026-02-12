SELECT
    ep.sentiment,
    COUNT(*) AS count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id
  AND ep.sentiment IS NOT NULL
GROUP BY ep.sentiment
ORDER BY count DESC;
