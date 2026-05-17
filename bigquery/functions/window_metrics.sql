-- window_metrics TVF.
--
-- Single-row, whole-window summary for a single agent's scoped posts.
-- Companion to `daily_metrics` (per-day breakdown) — call this when you want
-- "the totals" without dragging dozens of daily rows.
--
-- Filters / params (NULL = sensible default):
--   p_start    — inclusive lower bound on posted_at; NULL → no extra floor
--                beyond the agent's data_start_date (enforced by `scope_posts`)
--   p_end      — inclusive upper bound on posted_at; NULL → CURRENT_TIMESTAMP()
--   p_timezone — IANA timezone, used only for `active_days` and `n_days`;
--                NULL → 'UTC'
--
-- Engagement = likes + comments_count + shares + saves (same as daily_metrics).
-- Channel uniqueness keyed on (platform, channel_handle).
-- No share-of-voice columns — window vs. itself is 1.0 by definition.
--
-- Top-N qualitative arrays (each [{value, count}] ordered desc) use larger
-- caps than `daily_metrics` since this is a single row over a wider corpus:
--   * top_entities (50), top_themes (50), top_brands (50)
--   * top_content_types (20), top_emotions (20)
--
-- top_channels: top 10 channels by window engagement →
--   [{handle, platform, channel_type, posts, engagement, views}]
--
-- top_posts: top 10 posts by window engagement →
--   [{post_id, url, platform, channel_handle, posted_at, content_type,
--     sentiment, ai_summary, engagement, views}]
--
-- custom_fields_stats: identical auto-discovery cascade to `daily_metrics` /
-- `entity_metrics`, just grouped over the whole window. Falls back to JSON '{}'
-- when no custom_fields keys are observed.
--
-- Always returns exactly one row — even on an empty corpus (posts=0, top_*
-- fields are NULL, n_days NULL if no bound resolvable).

CREATE OR REPLACE TABLE FUNCTION social_listening.window_metrics(
    p_agent_id STRING,
    p_start TIMESTAMP,
    p_end TIMESTAMP,
    p_timezone STRING
) AS (
    WITH params AS (
        SELECT
            p_start                              AS start_ts,
            COALESCE(p_end, CURRENT_TIMESTAMP()) AS end_ts,
            COALESCE(p_timezone, 'UTC')          AS tz
    ),
    scoped AS (
        SELECT
            sp.post_id,
            sp.posted_at,
            sp.platform,
            sp.channel_handle,
            sp.channel_type,
            IF(sp.channel_handle IS NULL, NULL,
               CONCAT(COALESCE(sp.platform, ''), '||', sp.channel_handle)) AS channel_key,
            sp.post_url,
            sp.sentiment,
            sp.emotion,
            sp.content_type,
            sp.entities,
            sp.themes,
            sp.detected_brands,
            sp.ai_summary,
            sp.custom_fields,
            sp.views,
            sp.likes, sp.comments_count, sp.shares, sp.saves,
            (COALESCE(sp.likes, 0)
             + COALESCE(sp.comments_count, 0)
             + COALESCE(sp.shares, 0)
             + COALESCE(sp.saves, 0)) AS engagement
        FROM social_listening.scope_posts(p_agent_id) sp
        WHERE sp.posted_at >= COALESCE((SELECT start_ts FROM params), TIMESTAMP('1970-01-01'))
          AND sp.posted_at <= (SELECT end_ts FROM params)
    ),
    -- Single-row anchor; guarantees one output row even when scoped is empty.
    bounds AS (
        SELECT
            (SELECT start_ts FROM params)        AS start_ts,
            (SELECT end_ts   FROM params)        AS end_ts,
            (SELECT tz       FROM params)        AS tz,
            (SELECT MIN(posted_at) FROM scoped)  AS first_post,
            (SELECT MAX(posted_at) FROM scoped)  AS last_post
    ),
    agg AS (
        SELECT
            COUNT(post_id) AS posts,
            SUM(COALESCE(views, 0)) AS total_views,
            SUM(engagement) AS total_engagement,
            COUNTIF(LOWER(sentiment) = 'positive') AS pos_mentions,
            COUNTIF(LOWER(sentiment) = 'negative') AS neg_mentions,
            COUNTIF(LOWER(sentiment) = 'neutral')  AS neu_mentions,
            COUNT(DISTINCT channel_key) AS unique_channels,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'ugc',        channel_key, NULL)) AS unique_channels_ugc,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'official',   channel_key, NULL)) AS unique_channels_official,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'media',      channel_key, NULL)) AS unique_channels_media,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'influencer', channel_key, NULL)) AS unique_channels_influencers,
            COUNT(DISTINCT DATE(posted_at, (SELECT tz FROM params))) AS active_days
        FROM scoped
    ),
    -- ===================== top-N qualitative breakdowns =====================
    entities_long AS (
        SELECT LOWER(TRIM(e)) AS value
        FROM scoped, UNNEST(entities) AS e
        WHERE e IS NOT NULL AND TRIM(e) != ''
    ),
    entity_counts AS (
        SELECT value, COUNT(*) AS c FROM entities_long GROUP BY value
    ),
    top_entities_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 50)) AS top_entities
        FROM entity_counts
    ),
    themes_long AS (
        SELECT theme AS value
        FROM scoped, UNNEST(themes) AS theme
        WHERE theme IS NOT NULL AND theme != ''
    ),
    theme_counts AS (
        SELECT value, COUNT(*) AS c FROM themes_long GROUP BY value
    ),
    top_themes_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 50)) AS top_themes
        FROM theme_counts
    ),
    brands_long AS (
        SELECT brand AS value
        FROM scoped, UNNEST(detected_brands) AS brand
        WHERE brand IS NOT NULL AND brand != ''
    ),
    brand_counts AS (
        SELECT value, COUNT(*) AS c FROM brands_long GROUP BY value
    ),
    top_brands_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 50)) AS top_brands
        FROM brand_counts
    ),
    content_type_counts AS (
        SELECT content_type AS value, COUNT(*) AS c
        FROM scoped
        WHERE content_type IS NOT NULL AND content_type != ''
        GROUP BY content_type
    ),
    top_content_types_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 20)) AS top_content_types
        FROM content_type_counts
    ),
    emotion_counts AS (
        SELECT emotion AS value, COUNT(*) AS c
        FROM scoped
        WHERE emotion IS NOT NULL AND emotion != ''
        GROUP BY emotion
    ),
    top_emotions_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 20)) AS top_emotions
        FROM emotion_counts
    ),
    -- ===================== top channels over window =====================
    channel_window AS (
        SELECT
            channel_handle,
            ANY_VALUE(platform) AS platform,
            ANY_VALUE(channel_type) AS channel_type,
            COUNT(*) AS posts,
            SUM(engagement) AS engagement,
            SUM(COALESCE(views, 0)) AS views
        FROM scoped
        WHERE channel_handle IS NOT NULL
        GROUP BY channel_handle
    ),
    top_channels_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(
                   channel_handle AS handle,
                   platform,
                   channel_type,
                   posts,
                   engagement,
                   views
               ) ORDER BY engagement DESC, posts DESC, channel_handle LIMIT 10)) AS top_channels
        FROM channel_window
    ),
    -- ===================== top posts over window =====================
    top_posts_ranked AS (
        SELECT
            post_id, post_url, platform, channel_handle, posted_at,
            content_type, sentiment, ai_summary, engagement, views,
            ROW_NUMBER() OVER (
                ORDER BY engagement DESC, COALESCE(views, 0) DESC, post_id
            ) AS _rn
        FROM scoped
    ),
    top_posts_json AS (
        SELECT TO_JSON(ARRAY_AGG(STRUCT(
                   post_id,
                   post_url AS url,
                   platform,
                   channel_handle,
                   posted_at,
                   content_type,
                   sentiment,
                   ai_summary,
                   engagement,
                   COALESCE(views, 0) AS views
               ) ORDER BY engagement DESC, COALESCE(views, 0) DESC, post_id LIMIT 10)) AS top_posts
        FROM top_posts_ranked
        WHERE _rn <= 10
    ),
    -- ===================== custom_fields auto-discovery =====================
    -- Mirrors daily_metrics / entity_metrics; just grouped over the whole window.
    custom_long AS (
        SELECT ck AS key,
               JSON_TYPE(s.custom_fields[ck]) AS jtype,
               JSON_VALUE(s.custom_fields[ck]) AS sval,
               SAFE_CAST(JSON_VALUE(s.custom_fields[ck]) AS FLOAT64) AS nval
        FROM scoped s,
             UNNEST(JSON_KEYS(s.custom_fields, 1)) AS ck
        WHERE s.custom_fields IS NOT NULL
    ),
    custom_filtered AS (
        SELECT * FROM custom_long
        WHERE jtype IN ('string', 'number', 'boolean')
    ),
    type_counts AS (
        SELECT key, jtype, COUNT(*) AS c
        FROM custom_filtered
        GROUP BY key, jtype
    ),
    type_summary AS (
        SELECT key,
               ARRAY_AGG(jtype ORDER BY c DESC, jtype LIMIT 1)[OFFSET(0)] AS modal_type,
               COUNT(*) AS distinct_types,
               ARRAY_AGG(STRUCT(jtype AS type, c AS count) ORDER BY c DESC) AS type_counts_arr
        FROM type_counts
        GROUP BY key
    ),
    value_counts_raw AS (
        SELECT key, sval, COUNT(*) AS c
        FROM custom_filtered
        WHERE sval IS NOT NULL
        GROUP BY key, sval
    ),
    top_values AS (
        SELECT key,
               ARRAY_AGG(STRUCT(sval AS value, c AS count)
                         ORDER BY c DESC, sval LIMIT 20) AS value_counts_arr,
               COUNT(*) AS n_distinct,
               COUNT(*) > 20 AS truncated,
               SUM(c) AS non_null_count
        FROM value_counts_raw
        GROUP BY key
    ),
    numeric_stats AS (
        SELECT key,
               COUNT(nval) AS count_numeric,
               AVG(nval) AS mean_v,
               STDDEV_SAMP(nval) AS std_v,
               MIN(nval) AS min_v,
               MAX(nval) AS max_v,
               SUM(nval) AS sum_v,
               APPROX_QUANTILES(nval, 4) AS quartiles
        FROM custom_filtered
        WHERE nval IS NOT NULL
        GROUP BY key
    ),
    per_field_json AS (
        SELECT
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
        LEFT JOIN top_values    tv USING (key)
        LEFT JOIN numeric_stats ns USING (key)
    ),
    -- Wrap in a subquery + HAVING so the empty case produces zero rows;
    -- COALESCE then supplies an empty object instead of erroring on NULL inputs
    -- to JSON_OBJECT.
    custom_fields_stats_cte AS (
        SELECT COALESCE(
            (SELECT JSON_OBJECT(ARRAY_AGG(key ORDER BY key),
                                ARRAY_AGG(field_json ORDER BY key))
             FROM per_field_json
             HAVING COUNT(*) > 0),
            JSON '{}'
        ) AS custom_fields_stats
    )
    SELECT
        -- Window shape
        b.start_ts,
        b.end_ts,
        b.first_post,
        b.last_post,
        DATE_DIFF(
            DATE(b.end_ts, b.tz),
            DATE(COALESCE(b.start_ts, b.first_post), b.tz),
            DAY
        ) + 1 AS n_days,
        COALESCE(a.active_days, 0) AS active_days,
        -- Volume
        COALESCE(a.posts, 0)            AS posts,
        COALESCE(a.total_views, 0)      AS total_views,
        COALESCE(a.total_engagement, 0) AS total_engagement,
        SAFE_DIVIDE(a.total_engagement, a.posts) AS avg_engagement_per_post,
        -- Sentiment
        COALESCE(a.pos_mentions, 0) AS pos_mentions,
        COALESCE(a.neg_mentions, 0) AS neg_mentions,
        COALESCE(a.neu_mentions, 0) AS neu_mentions,
        SAFE_DIVIDE(a.pos_mentions - a.neg_mentions, a.posts) AS net_sentiment,
        -- Channels
        COALESCE(a.unique_channels, 0)             AS unique_channels,
        COALESCE(a.unique_channels_ugc, 0)         AS unique_channels_ugc,
        COALESCE(a.unique_channels_official, 0)    AS unique_channels_official,
        COALESCE(a.unique_channels_media, 0)       AS unique_channels_media,
        COALESCE(a.unique_channels_influencers, 0) AS unique_channels_influencers,
        -- Qualitative top-N
        tej.top_entities,
        ttj.top_themes,
        tbj.top_brands,
        tctj.top_content_types,
        toej.top_emotions,
        tcj.top_channels,
        tpj.top_posts,
        cfs.custom_fields_stats
    FROM bounds b
    CROSS JOIN agg                     a
    CROSS JOIN top_entities_json       tej
    CROSS JOIN top_themes_json         ttj
    CROSS JOIN top_brands_json         tbj
    CROSS JOIN top_content_types_json  tctj
    CROSS JOIN top_emotions_json       toej
    CROSS JOIN top_channels_json       tcj
    CROSS JOIN top_posts_json          tpj
    CROSS JOIN custom_fields_stats_cte cfs
);
