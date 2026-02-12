WITH post_entities AS (
    SELECT
        p.post_id,
        entity
    FROM social_listening.posts p
    JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id,
        UNNEST(ep.entities) AS entity
    WHERE p.collection_id = @collection_id
)
SELECT
    a.entity AS entity_a,
    b.entity AS entity_b,
    COUNT(DISTINCT a.post_id) AS co_occurrence_count
FROM post_entities a
JOIN post_entities b ON a.post_id = b.post_id AND a.entity < b.entity
GROUP BY entity_a, entity_b
HAVING co_occurrence_count >= 2
ORDER BY co_occurrence_count DESC
LIMIT 30;
