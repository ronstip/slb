CREATE CONTINUOUS QUERY cq_embed
ON social_listening.enriched_posts
AS
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
        WHERE ep.ai_summary IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM social_listening.post_embeddings pe
              WHERE pe.post_id = ep.post_id
          )
    ),
    STRUCT(768 AS output_dimensionality)
) AS result;
