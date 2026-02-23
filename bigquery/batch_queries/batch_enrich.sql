-- Batch enrichment: enrich posts using BQ integrated LLMs.
-- Supports two input modes:
--   @collection_id — enrich all qualifying posts in a collection
--   @post_ids — enrich specific posts by ID
-- Posts must have >= @min_likes likes to qualify (default 0 = enrich all).
--
-- Uses MERGE instead of INSERT + NOT EXISTS to atomically handle duplicates:
--   WHEN NOT MATCHED → inserts new enrichment
--   WHEN MATCHED     → updates existing enrichment (fixes streaming-buffer race duplicates)
-- QUALIFY deduplicates input when the same post_id spans multiple collections.
MERGE social_listening.enriched_posts AS target
USING (
    SELECT
        post_id,
        JSON_VALUE(analysis, '$.sentiment') AS sentiment,
        ARRAY(SELECT JSON_VALUE(e) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.entities')) AS e) AS entities,
        ARRAY(SELECT JSON_VALUE(t) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.themes')) AS t) AS themes,
        JSON_VALUE(analysis, '$.ai_summary') AS ai_summary,
        JSON_VALUE(analysis, '$.language') AS language,
        JSON_VALUE(analysis, '$.content_type') AS content_type
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
                WHERE COALESCE(eng.likes, 0) >= @min_likes
                AND (
                    p.collection_id = @collection_id
                    OR p.post_id IN UNNEST(@post_ids)
                )
                -- Deduplicate: if the same post_id appears across multiple collections,
                -- send it to the LLM only once (most recently collected version)
                QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY p.collected_at DESC) = 1
            ),
            STRUCT(0.2 AS temperature, 2048 AS max_output_tokens)
        ) AS result
    )
) AS source
ON target.post_id = source.post_id
WHEN NOT MATCHED THEN
    INSERT (post_id, sentiment, entities, themes, ai_summary, language, content_type, enriched_at)
    VALUES (source.post_id, source.sentiment, source.entities, source.themes, source.ai_summary, source.language, source.content_type, CURRENT_TIMESTAMP())
WHEN MATCHED THEN
    UPDATE SET
        sentiment    = source.sentiment,
        entities     = source.entities,
        themes       = source.themes,
        ai_summary   = source.ai_summary,
        language     = source.language,
        content_type = source.content_type,
        enriched_at  = CURRENT_TIMESTAMP();
