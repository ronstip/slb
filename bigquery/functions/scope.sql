-- Table functions that gate post access for agent queries.
--
-- Each call returns one row per post that:
--   * has been enriched by this agent (joined to `enriched_posts` on agent_id)
--   * is marked relevant to the agent's task (is_related_to_task IS TRUE)
--   * is deduped to the latest collection record (latest collected_at),
--     latest enrichment (latest agent_version, then enriched_at),
--     and latest engagement snapshot (latest fetched_at)
--   * has `posted_at` >= the agent's currently-active `data_start_date`
--     (the most recent row in `agents` for this agent_id, by `created_at`).
--     Agents with no `data_start_date` row (legacy) get no lower bound.
--
-- Anything else (end date, platforms, collection_ids, exclude lists,
-- specific agent_version) belongs in the caller's WHERE clause.

CREATE OR REPLACE TABLE FUNCTION social_listening.scope_post_ids(
    p_agent_id STRING
) AS (
    WITH agent_window AS (
        SELECT data_start_date
        FROM social_listening.agents
        WHERE agent_id = p_agent_id
          AND data_start_date IS NOT NULL
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
    ),
    dedup_posts AS (
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
                       ORDER BY (ep.source = 'user_override') DESC,
                                ep.agent_version DESC NULLS LAST,
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
      AND p.posted_at >= COALESCE(
          TIMESTAMP((SELECT data_start_date FROM agent_window)),
          TIMESTAMP('1970-01-01')
      )
);


CREATE OR REPLACE TABLE FUNCTION social_listening.scope_posts(
    p_agent_id STRING
) AS (
    WITH agent_window AS (
        SELECT data_start_date
        FROM social_listening.agents
        WHERE agent_id = p_agent_id
          AND data_start_date IS NOT NULL
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
    ),
    dedup_posts AS (
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
                       ORDER BY (ep.source = 'user_override') DESC,
                                ep.agent_version DESC NULLS LAST,
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
      AND p.posted_at >= COALESCE(
          TIMESTAMP((SELECT data_start_date FROM agent_window)),
          TIMESTAMP('1970-01-01')
      )
);


-- Comment-grain analogue of scope_posts. Returns one row per comment that:
--   * has been enriched by this agent (joined to `enriched_comments` on agent_id)
--   * is itself marked relevant (its OWN is_related_to_task IS TRUE - a comment
--     carries an independent relevance gate, so off-topic/spam replies drop even
--     under a relevant parent)
--   * is deduped to the latest fetch record (latest fetched_at) and latest
--     enrichment (user_override > agent_version > enriched_at)
--   * belongs to a parent post whose `posted_at` >= the agent's active
--     `data_start_date` (the data window keys off the PARENT post time, keeping
--     a thread atomic with its post; comments have no collection_id of their
--     own, so collection_id is inherited from the parent).
--
-- Output columns mirror the subset of scope_posts that build_dashboard_sql
-- projects, so a comment widget reuses the post aggregation path unchanged
-- (the caller aliases comment_id -> post_id). `posted_at` is the COMMENT's
-- time (so time widgets read comment activity); the parent's time is only the
-- window gate. `parent_ai_summary` is denormalized for callers that want it.
CREATE OR REPLACE TABLE FUNCTION social_listening.scope_comments(
    p_agent_id STRING
) AS (
    WITH agent_window AS (
        SELECT data_start_date
        FROM social_listening.agents
        WHERE agent_id = p_agent_id
          AND data_start_date IS NOT NULL
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
    ),
    dedup_comments AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT c.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY c.comment_id
                       ORDER BY c.fetched_at DESC
                   ) AS _rn
            FROM social_listening.comments c
        )
        WHERE _rn = 1
    ),
    dedup_cenr AS (
        SELECT * EXCEPT(_rn) FROM (
            SELECT ce.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY ce.comment_id
                       ORDER BY (ce.source = 'user_override') DESC,
                                ce.agent_version DESC NULLS LAST,
                                ce.enriched_at DESC
                   ) AS _rn
            FROM social_listening.enriched_comments ce
            WHERE ce.agent_id = p_agent_id
        )
        WHERE _rn = 1
    ),
    -- Parent post (latest collected record) for collection_id + the window gate.
    dedup_parent AS (
        SELECT post_id, collection_id, posted_at, post_url, content FROM (
            SELECT p.post_id, p.collection_id, p.posted_at, p.post_url, p.content,
                   ROW_NUMBER() OVER (
                       PARTITION BY p.post_id ORDER BY p.collected_at DESC
                   ) AS _rn
            FROM social_listening.posts p
        )
        WHERE _rn = 1
    ),
    -- Parent's own enrichment, for the denormalized parent_ai_summary.
    dedup_parent_enr AS (
        SELECT post_id, ai_summary FROM (
            SELECT ep.post_id, ep.ai_summary,
                   ROW_NUMBER() OVER (
                       PARTITION BY ep.post_id
                       ORDER BY (ep.source = 'user_override') DESC,
                                ep.agent_version DESC NULLS LAST,
                                ep.enriched_at DESC
                   ) AS _rn
            FROM social_listening.enriched_posts ep
            WHERE ep.agent_id = p_agent_id
        )
        WHERE _rn = 1
    )
    SELECT
      c.comment_id,
      c.post_id AS parent_post_id,
      c.root_comment_id,
      par.collection_id,
      c.platform,
      c.channel_handle,
      c.channel_id,
      c.commented_at AS posted_at,
      CAST(NULL AS STRING) AS title,
      c.content,
      COALESCE(c.comment_url, par.post_url) AS post_url,
      COALESCE(c.post_type, 'comment') AS post_type,
      ce.agent_version, ce.context, ce.sentiment, ce.emotion,
      ce.entities, ce.themes, ce.ai_summary, ce.language, ce.content_type,
      ce.detected_brands, ce.channel_type, ce.custom_fields, ce.enriched_at,
      c.media_refs, c.platform_metadata,
      pe.ai_summary AS parent_ai_summary,
      par.content AS parent_post_content,
      c.likes, c.views,
      c.replies_count AS comments_count, c.shares
    FROM dedup_comments c
    JOIN dedup_cenr ce USING (comment_id)
    JOIN dedup_parent par ON par.post_id = c.post_id
    LEFT JOIN dedup_parent_enr pe ON pe.post_id = c.post_id
    WHERE ce.is_related_to_task IS TRUE
      AND par.posted_at >= COALESCE(
          TIMESTAMP((SELECT data_start_date FROM agent_window)),
          TIMESTAMP('1970-01-01')
      )
);
