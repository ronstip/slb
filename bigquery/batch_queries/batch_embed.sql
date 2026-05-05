-- Batch embedding: generate vector embeddings for enriched posts.
-- Supports two input modes:
--   @collection_id — embed all enriched posts in a collection
--   @post_ids — embed specific posts by ID
INSERT INTO social_listening.post_embeddings (
    post_id, embedding, embedding_model, embedded_at
)
SELECT
    result.post_id,
    result.embedding,
    'text-embedding-005',
    CURRENT_TIMESTAMP()
FROM AI.GENERATE_EMBEDDING(
    MODEL social_listening.embedding_model,
    (
        -- Dedupe: enriched_posts now allows N rows per post (per agent + version).
        -- Embed only the latest enrichment so we don't generate N embeddings per post.
        SELECT
            ep.post_id,
            COALESCE(ep.ai_summary, '') AS content
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY post_id
                ORDER BY agent_version DESC NULLS LAST, enriched_at DESC
            ) AS _rn
            FROM social_listening.enriched_posts
        ) ep
        JOIN social_listening.posts p ON p.post_id = ep.post_id
        WHERE ep._rn = 1
          AND ep.ai_summary IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM social_listening.post_embeddings pe
              WHERE pe.post_id = ep.post_id
          )
          AND (
              p.collection_id = @collection_id
              OR ep.post_id IN UNNEST(@post_ids)
          )
    ),
    STRUCT(768 AS output_dimensionality)
) AS result;
