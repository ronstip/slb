-- entity_metrics TVF.
--
-- Per-entity analysis within a single agent's scoped posts, optionally
-- filtered by time window and platform. For each entity group, returns
-- volume, share-of-voice (vs. full filtered corpus), sentiment breakdown,
-- unique channels by channel_type, average engagement per mention,
-- first/last mention, top content_type, top emotion, JSON value-counts
-- for content_type and themes, and an auto-discovered JSON summary of
-- every top-level key in `custom_fields`.
--
-- Each group has a `canonical` name and a list of `variants` (e.g. ['lakers',
-- 'los angeles lakers', 'lal']). Variants are matched case-insensitively
-- against the `entities` array on `enriched_posts`.
--
-- Filters (NULL = no filter / "all"):
--   p_start     - inclusive lower bound on posted_at
--   p_end       - inclusive upper bound on posted_at
--   p_platforms - list of platforms to include; NULL or [] means all
--
-- Channel uniqueness keys on (platform, channel_handle) so the same handle
-- on different platforms is counted as two distinct channels.
--
-- custom_fields_stats: JSON object keyed by every top-level custom_fields
-- key observed in the entity's matched posts. Per key:
--   - type: 'string' | 'number' | 'boolean' | 'mixed'
--           (object/array values are skipped)
--   - non_null:    # of posts where the key was present
--   - n_distinct:  # of distinct values (categorical / boolean / mixed)
--   - value_counts: top 20 values as [{value, count}], ordered desc
--   - truncated:   true if more than 20 distinct values
--   - For numeric and mixed types, also: count_numeric, mean, std, min,
--     p25, median, p75, max, iqr, sum (over the cleanly-castable subset)
--   - For mixed: type_counts: [{type, count}] showing the type breakdown
--
-- Empty groups (no matches) stay in the output with zero/NULL metrics.

CREATE OR REPLACE TABLE FUNCTION social_listening.entity_metrics(
    p_agent_id STRING,
    p_entity_groups ARRAY<STRUCT<canonical STRING, variants ARRAY<STRING>>>,
    p_start TIMESTAMP,
    p_end TIMESTAMP,
    p_platforms ARRAY<STRING>
) AS (
    WITH scoped AS (
        SELECT post_id, entities, posted_at, platform,
               channel_type,
               IF(channel_handle IS NULL, NULL,
                  CONCAT(COALESCE(platform, ''), '||', channel_handle)) AS channel_key,
               sentiment, emotion, content_type, themes, custom_fields,
               views, likes, comments_count, shares, saves
        FROM social_listening.scope_posts(p_agent_id)
        WHERE posted_at >= COALESCE(p_start, TIMESTAMP('1970-01-01'))
          AND posted_at <= COALESCE(p_end,   TIMESTAMP('2999-12-31'))
          AND (p_platforms IS NULL
               OR ARRAY_LENGTH(p_platforms) = 0
               OR platform IN UNNEST(p_platforms))
    ),
    corpus_totals AS (
        SELECT
            COUNT(DISTINCT post_id) AS total_posts,
            SUM(COALESCE(views, 0)) AS total_views_all,
            SUM(COALESCE(likes, 0)
              + COALESCE(comments_count, 0)
              + COALESCE(shares, 0)
              + COALESCE(saves, 0)) AS total_engagement_all
        FROM scoped
    ),
    post_entities AS (
        SELECT s.post_id, LOWER(TRIM(entity)) AS entity_norm
        FROM scoped s, UNNEST(s.entities) AS entity
    ),
    matched_posts AS (
        SELECT DISTINCT g.canonical, pe.post_id
        FROM UNNEST(p_entity_groups) g
        LEFT JOIN post_entities pe
          ON pe.entity_norm IN UNNEST(
              ARRAY(SELECT LOWER(TRIM(v)) FROM UNNEST(g.variants) v)
          )
    ),
    matched AS (
        SELECT mp.canonical, mp.post_id,
               s.posted_at, s.sentiment, s.emotion, s.content_type, s.themes,
               s.channel_key, s.channel_type, s.custom_fields,
               s.views, s.likes, s.comments_count, s.shares, s.saves
        FROM matched_posts mp
        LEFT JOIN scoped s USING (post_id)
    ),
    agg AS (
        SELECT
            canonical,
            COUNT(DISTINCT post_id) AS mentions,
            SUM(COALESCE(views, 0)) AS total_views,
            SUM(COALESCE(likes, 0)
              + COALESCE(comments_count, 0)
              + COALESCE(shares, 0)
              + COALESCE(saves, 0)) AS total_engagement,
            COUNTIF(LOWER(sentiment) = 'positive') AS pos_mentions,
            COUNTIF(LOWER(sentiment) = 'negative') AS neg_mentions,
            COUNTIF(LOWER(sentiment) = 'neutral')  AS neu_mentions,
            COUNT(DISTINCT channel_key) AS unique_channels,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'ugc',        channel_key, NULL)) AS unique_channels_ugc,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'official',   channel_key, NULL)) AS unique_channels_official,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'media',      channel_key, NULL)) AS unique_channels_media,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'influencer', channel_key, NULL)) AS unique_channels_influencers,
            MIN(posted_at) AS first_mention,
            MAX(posted_at) AS last_mention
        FROM matched
        GROUP BY canonical
    ),
    content_type_counts AS (
        SELECT canonical, content_type, COUNT(*) AS c
        FROM matched
        WHERE content_type IS NOT NULL AND content_type != ''
        GROUP BY canonical, content_type
    ),
    top_content_type AS (
        SELECT canonical,
               ARRAY_AGG(content_type ORDER BY c DESC, content_type LIMIT 1)[OFFSET(0)] AS top_content_type
        FROM content_type_counts
        GROUP BY canonical
    ),
    content_type_counts_json AS (
        SELECT canonical,
               TO_JSON(ARRAY_AGG(STRUCT(content_type AS value, c AS count)
                                 ORDER BY c DESC, content_type LIMIT 20)) AS content_type_counts
        FROM content_type_counts
        GROUP BY canonical
    ),
    themes_long AS (
        SELECT m.canonical, theme
        FROM matched m, UNNEST(m.themes) AS theme
        WHERE theme IS NOT NULL AND theme != ''
    ),
    themes_counts AS (
        SELECT canonical, theme, COUNT(*) AS c
        FROM themes_long
        GROUP BY canonical, theme
    ),
    themes_counts_json AS (
        SELECT canonical,
               TO_JSON(ARRAY_AGG(STRUCT(theme AS value, c AS count)
                                 ORDER BY c DESC, theme LIMIT 20)) AS themes_counts
        FROM themes_counts
        GROUP BY canonical
    ),
    emotion_counts AS (
        SELECT canonical, emotion, COUNT(*) AS c
        FROM matched
        WHERE emotion IS NOT NULL AND emotion != ''
        GROUP BY canonical, emotion
    ),
    top_emotion AS (
        SELECT canonical,
               ARRAY_AGG(emotion ORDER BY c DESC, emotion LIMIT 1)[OFFSET(0)] AS top_emotion
        FROM emotion_counts
        GROUP BY canonical
    ),
    -- ===================== custom_fields auto-discovery =====================
    -- Explode each top-level key per matched post; capture JSON_TYPE,
    -- string view, and SAFE_CAST numeric view.
    custom_long AS (
        SELECT m.canonical, ck AS key,
               JSON_TYPE(m.custom_fields[ck]) AS jtype,
               JSON_VALUE(m.custom_fields[ck]) AS sval,
               SAFE_CAST(JSON_VALUE(m.custom_fields[ck]) AS FLOAT64) AS nval
        FROM matched m,
             UNNEST(JSON_KEYS(m.custom_fields, 1)) AS ck
        WHERE m.custom_fields IS NOT NULL
    ),
    -- Skip object/array/null values per the spec.
    custom_filtered AS (
        SELECT * FROM custom_long
        WHERE jtype IN ('string', 'number', 'boolean')
    ),
    type_counts AS (
        SELECT canonical, key, jtype, COUNT(*) AS c
        FROM custom_filtered
        GROUP BY canonical, key, jtype
    ),
    type_summary AS (
        SELECT canonical, key,
               ARRAY_AGG(jtype ORDER BY c DESC, jtype LIMIT 1)[OFFSET(0)] AS modal_type,
               COUNT(*) AS distinct_types,
               ARRAY_AGG(STRUCT(jtype AS type, c AS count) ORDER BY c DESC) AS type_counts_arr
        FROM type_counts
        GROUP BY canonical, key
    ),
    value_counts_raw AS (
        SELECT canonical, key, sval, COUNT(*) AS c
        FROM custom_filtered
        WHERE sval IS NOT NULL
        GROUP BY canonical, key, sval
    ),
    top_values AS (
        SELECT canonical, key,
               ARRAY_AGG(STRUCT(
                   sval AS value,
                   c AS count
               ) ORDER BY c DESC, sval LIMIT 20) AS value_counts_arr,
               COUNT(*) AS n_distinct,
               COUNT(*) > 20 AS truncated,
               SUM(c) AS non_null_count
        FROM value_counts_raw
        GROUP BY canonical, key
    ),
    numeric_stats AS (
        SELECT canonical, key,
               COUNT(nval) AS count_numeric,
               AVG(nval) AS mean_v,
               STDDEV_SAMP(nval) AS std_v,
               MIN(nval) AS min_v,
               MAX(nval) AS max_v,
               SUM(nval) AS sum_v,
               APPROX_QUANTILES(nval, 4) AS quartiles
        FROM custom_filtered
        WHERE nval IS NOT NULL
        GROUP BY canonical, key
    ),
    -- Build one JSON value per (entity, key). Three branches keep the JSON
    -- compact: string/boolean, number, or mixed (kitchen-sink).
    per_field_json AS (
        SELECT
            ts.canonical,
            ts.key,
            CASE
                WHEN ts.distinct_types > 1 THEN
                    TO_JSON(STRUCT(
                        'mixed' AS type,
                        ts.type_counts_arr AS type_counts,
                        tv.non_null_count AS non_null,
                        tv.n_distinct AS n_distinct,
                        tv.value_counts_arr AS value_counts,
                        tv.truncated AS truncated,
                        ns.count_numeric AS count_numeric,
                        ns.mean_v AS mean,
                        ns.std_v AS std,
                        ns.min_v AS min,
                        ns.quartiles[SAFE_OFFSET(1)] AS p25,
                        ns.quartiles[SAFE_OFFSET(2)] AS median,
                        ns.quartiles[SAFE_OFFSET(3)] AS p75,
                        ns.max_v AS max,
                        (ns.quartiles[SAFE_OFFSET(3)] - ns.quartiles[SAFE_OFFSET(1)]) AS iqr,
                        ns.sum_v AS sum
                    ))
                WHEN ts.modal_type = 'number' THEN
                    TO_JSON(STRUCT(
                        'number' AS type,
                        tv.non_null_count AS non_null,
                        tv.n_distinct AS n_distinct,
                        ns.count_numeric AS count_numeric,
                        ns.mean_v AS mean,
                        ns.std_v AS std,
                        ns.min_v AS min,
                        ns.quartiles[SAFE_OFFSET(1)] AS p25,
                        ns.quartiles[SAFE_OFFSET(2)] AS median,
                        ns.quartiles[SAFE_OFFSET(3)] AS p75,
                        ns.max_v AS max,
                        (ns.quartiles[SAFE_OFFSET(3)] - ns.quartiles[SAFE_OFFSET(1)]) AS iqr,
                        ns.sum_v AS sum,
                        tv.value_counts_arr AS value_counts,
                        tv.truncated AS truncated
                    ))
                ELSE
                    TO_JSON(STRUCT(
                        ts.modal_type AS type,
                        tv.non_null_count AS non_null,
                        tv.n_distinct AS n_distinct,
                        tv.value_counts_arr AS value_counts,
                        tv.truncated AS truncated
                    ))
            END AS field_json
        FROM type_summary ts
        LEFT JOIN top_values tv USING (canonical, key)
        LEFT JOIN numeric_stats ns USING (canonical, key)
    ),
    custom_fields_per_entity AS (
        SELECT canonical,
               JSON_OBJECT(ARRAY_AGG(key ORDER BY key),
                           ARRAY_AGG(field_json ORDER BY key)) AS custom_fields_stats
        FROM per_field_json
        GROUP BY canonical
    )
    SELECT
        a.canonical AS entity,
        -- Volume
        a.mentions,
        a.total_views,
        a.total_engagement,
        SAFE_DIVIDE(a.total_engagement, a.mentions) AS avg_engagement_per_mention,
        -- Share of voice (vs. full filtered corpus)
        SAFE_DIVIDE(a.mentions,         c.total_posts)          AS sov_mentions,
        SAFE_DIVIDE(a.total_views,      c.total_views_all)      AS sov_views,
        SAFE_DIVIDE(a.total_engagement, c.total_engagement_all) AS sov_engagement,
        -- Sentiment
        a.pos_mentions,
        a.neg_mentions,
        a.neu_mentions,
        SAFE_DIVIDE(a.pos_mentions - a.neg_mentions, a.mentions) AS net_sentiment,
        -- Channels (unique on platform + handle)
        a.unique_channels,
        a.unique_channels_ugc,
        a.unique_channels_official,
        a.unique_channels_media,
        a.unique_channels_influencers,
        -- Time
        a.first_mention,
        a.last_mention,
        -- Top values
        tct.top_content_type,
        te.top_emotion,
        -- Value counts (JSON arrays of {value, count})
        ctcj.content_type_counts,
        tcj.themes_counts,
        -- Custom fields (auto-discovered, JSON)
        cfpe.custom_fields_stats
    FROM agg a
    CROSS JOIN corpus_totals c
    LEFT JOIN top_content_type         tct  USING (canonical)
    LEFT JOIN top_emotion              te   USING (canonical)
    LEFT JOIN content_type_counts_json ctcj USING (canonical)
    LEFT JOIN themes_counts_json       tcj  USING (canonical)
    LEFT JOIN custom_fields_per_entity cfpe USING (canonical)
);
