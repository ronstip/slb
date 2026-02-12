SELECT
    DATE(p.posted_at) AS post_date,
    p.platform,
    COUNT(*) AS post_count
FROM social_listening.posts p
WHERE p.collection_id = @collection_id
  AND p.posted_at IS NOT NULL
GROUP BY post_date, p.platform
ORDER BY post_date ASC;
