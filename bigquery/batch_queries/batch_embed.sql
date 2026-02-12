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
    MODEL `social_listening.embedding_model`,
    (
        SELECT
            ep.post_id,
            CONCAT(
                ep.ai_summary, ' | ',
                'sentiment: ', ep.sentiment, ' | ',
                'themes: ', ARRAY_TO_STRING(ep.themes, ', ')
            ) AS content
        FROM social_listening.enriched_posts ep
        JOIN social_listening.posts p ON p.post_id = ep.post_id
        WHERE ep.ai_summary IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM social_listening.post_embeddings pe
              WHERE pe.post_id = ep.post_id
          )
          AND (
              p.collection_id = @collection_id
              OR ep.post_id IN UNNEST(@post_ids)
          )
    )
) AS result;
