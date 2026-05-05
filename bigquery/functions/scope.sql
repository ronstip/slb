-- Table functions that gate post access for agent queries.
--
-- Each call returns one row per post that:
--   * has been enriched by this agent (joined to `enriched_posts` on agent_id)
--   * is marked relevant to the agent's task (is_related_to_task IS TRUE)
--   * is deduped to the latest collection record (latest collected_at),
--     latest enrichment (latest agent_version, then enriched_at),
--     and latest engagement snapshot (latest fetched_at)
--
-- Anything else (date range, platforms, collection_ids, exclude lists,
-- specific agent_version) belongs in the caller's WHERE clause.

CREATE OR REPLACE TABLE FUNCTION social_listening.scope_post_ids(
    p_agent_id STRING
) AS (
    WITH dedup_posts AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT p.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY p.post_id
                       ORDER BY p.collected_at DESC
                   ) AS _rn
            FROM social_listening.posts p
        )
        WHERE _rn = 1
    ),
    dedup_enr AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT ep.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY ep.post_id
                       ORDER BY ep.agent_version DESC NULLS LAST,
                                ep.enriched_at DESC
                   ) AS _rn
            FROM social_listening.enriched_posts ep
            WHERE ep.agent_id = p_agent_id
        )
        WHERE _rn = 1
    )
    SELECT p.post_id
    FROM dedup_posts p
    JOIN dedup_enr ep USING (post_id)
    WHERE ep.is_related_to_task IS TRUE
);


CREATE OR REPLACE TABLE FUNCTION social_listening.scope_posts(
    p_agent_id STRING
) AS (
    WITH dedup_posts AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT p.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY p.post_id
                       ORDER BY p.collected_at DESC
                   ) AS _rn
            FROM social_listening.posts p
        )
        WHERE _rn = 1
    ),
    dedup_enr AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT ep.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY ep.post_id
                       ORDER BY ep.agent_version DESC NULLS LAST,
                                ep.enriched_at DESC
                   ) AS _rn
            FROM social_listening.enriched_posts ep
            WHERE ep.agent_id = p_agent_id
        )
        WHERE _rn = 1
    ),
    dedup_eng AS (
        SELECT post_id, likes, views, comments_count, shares, saves,
               comments, platform_engagements,
               source AS engagement_source, fetched_at
        FROM social_listening.post_engagements
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY post_id ORDER BY fetched_at DESC
        ) = 1
    )
    SELECT
      p.post_id, p.collection_id, p.platform, p.channel_handle, p.channel_id,
      p.title, p.content, p.post_url, p.posted_at, p.post_type,
      p.parent_post_id, p.media_refs, p.platform_metadata, p.crawl_provider,
      p.search_keyword, p.collected_at,
      SAFE_CAST(JSON_VALUE(p.platform_metadata, '$.is_retweet') AS BOOL) AS is_retweet,
      SAFE_CAST(JSON_VALUE(p.platform_metadata, '$.is_quote_status') AS BOOL) AS is_quote,
      ep.agent_version, ep.context, ep.sentiment, ep.emotion,
      ep.entities, ep.themes, ep.ai_summary, ep.language, ep.content_type,
      ep.detected_brands, ep.channel_type,
      ep.custom_fields, ep.enriched_at,
      eng.likes, eng.views, eng.comments_count, eng.shares, eng.saves,
      eng.comments, eng.platform_engagements, eng.engagement_source,
      eng.fetched_at
    FROM dedup_posts p
    JOIN dedup_enr ep USING (post_id)
    LEFT JOIN dedup_eng eng USING (post_id)
    WHERE ep.is_related_to_task IS TRUE
);
