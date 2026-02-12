SELECT
    p.platform,
    COUNT(*) AS post_count
FROM social_listening.posts p
WHERE p.collection_id = @collection_id
GROUP BY p.platform
ORDER BY post_count DESC;
