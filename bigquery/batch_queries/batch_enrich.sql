-- Batch enrichment: enrich posts using BQ integrated LLMs.
-- Supports two input modes:
--   @collection_id — enrich all qualifying posts in a collection
--   @post_ids — enrich specific posts by ID
-- Posts must have >= 30 likes to qualify.
INSERT INTO social_listening.enriched_posts (
    post_id, sentiment, entities, themes,
    ai_summary, language, content_type, enriched_at
)
SELECT
    post_id,
    JSON_VALUE(analysis, '$.sentiment'),
    ARRAY(SELECT JSON_VALUE(e) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.entities')) AS e),
    ARRAY(SELECT JSON_VALUE(t) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.themes')) AS t),
    JSON_VALUE(analysis, '$.ai_summary'),
    JSON_VALUE(analysis, '$.language'),
    JSON_VALUE(analysis, '$.content_type'),
    CURRENT_TIMESTAMP()
FROM (
    SELECT
        result.post_id,
        SAFE.PARSE_JSON(
            -- Strip markdown code-block wrappers (```json ... ```) the LLM may add
            REGEXP_REPLACE(
                REGEXP_REPLACE(result.result, r'^```(?:json)?\s*', ''),
                r'\s*```\s*$', ''
            )
        ) AS analysis
    FROM AI.GENERATE_TEXT(
        MODEL `social_listening.enrichment_model`,
        (
            SELECT
                p.post_id,
                CONCAT(
                    'Analyze this social media post. Return ONLY valid JSON with no markdown formatting.\n',
                    'Fields:\n',
                    '  sentiment: one of positive/negative/neutral/mixed\n',
                    '  entities: array of brands, products, people mentioned\n',
                    '  themes: array of topic themes (e.g. skincare routine, product review)\n',
                    '  ai_summary: 2-3 sentence summary of the post\n',
                    '  language: detected language code (e.g. en, es, he)\n',
                    '  content_type: one of review/tutorial/meme/ad/unboxing/comparison/testimonial/other\n',
                    '\nPost context:\n',
                    'Platform: ', p.platform, '\n',
                    'Channel: ', COALESCE(p.channel_handle, 'unknown'), '\n',
                    'Posted: ', CAST(p.posted_at AS STRING), '\n',
                    'Title: ', COALESCE(p.title, ''), '\n',
                    'Text: ', COALESCE(p.content, '')
                ) AS prompt
                -- TODO: Add multimodal support when BQ reservation is configured:
                -- , mo.uri AS media_uri
            FROM social_listening.posts p
            -- LEFT JOIN social_listening.media_objects mo
            --     ON mo.uri = JSON_VALUE(p.media_refs, '$[0].gcs_uri')
            LEFT JOIN (
                SELECT post_id, likes,
                    ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
                FROM social_listening.post_engagements
            ) eng ON eng.post_id = p.post_id AND eng.rn = 1
            WHERE NOT EXISTS (
                SELECT 1 FROM social_listening.enriched_posts ep
                WHERE ep.post_id = p.post_id
            )
            AND COALESCE(eng.likes, 0) >= 30
            AND (
                p.collection_id = @collection_id
                OR p.post_id IN UNNEST(@post_ids)
            )
        ),
        STRUCT(0.2 AS temperature, 2048 AS max_output_tokens)
    ) AS result
);
