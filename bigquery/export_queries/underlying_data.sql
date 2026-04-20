-- Deterministic underlying data query for artifacts.
-- Anchored by @created_at so the result set is stable over time:
-- rows inserted after the artifact creation timestamp are excluded.
WITH deduped_posts AS (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
            WHERE collection_id IN UNNEST(@collection_ids)
              AND collected_at <= @created_at
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
),
deduped_enriched AS (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
    FROM social_listening.enriched_posts
    WHERE enriched_at <= @created_at
),
deduped_engagements AS (
    SELECT post_id, likes, shares, views, comments_count, saves,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS _rn
    FROM social_listening.post_engagements
    WHERE fetched_at <= @created_at
)
SELECT
    p.collection_id,
    p.post_id,
    p.platform,
    p.channel_handle,
    p.title,
    p.content,
    p.post_url,
    p.posted_at,
    p.post_type,
    p.media_refs,
    eng.likes,
    eng.shares,
    eng.views,
    eng.comments_count,
    eng.saves,
    COALESCE(eng.likes, 0) + COALESCE(eng.shares, 0) + COALESCE(eng.views, 0) AS total_engagement,
    ep.sentiment,
    ep.emotion,
    ep.themes,
    ep.entities,
    ep.ai_summary,
    ep.content_type
FROM deduped_posts p
LEFT JOIN deduped_engagements eng ON eng.post_id = p.post_id AND eng._rn = 1
JOIN deduped_enriched ep ON ep.post_id = p.post_id AND ep._rn = 1
    AND ep.is_related_to_task = TRUE
WHERE p._rn = 1
ORDER BY p.posted_at DESC;
