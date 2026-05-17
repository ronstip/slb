-- daily_metrics TVF.
--
-- Per-day analytics for a single agent's scoped posts. Returns one row for
-- EVERY DATE in [p_start, p_end] (empty days kept with zero/NULL metrics),
-- with both quantitative aggregates and qualitative top-N JSON summaries —
-- everything an LLM needs to read the dataset day-by-day.
--
-- Filters / params (NULL = sensible default):
--   p_start    — inclusive lower bound on posted_at; NULL → MIN(posted_at)
--                across the agent's scoped corpus (which itself respects
--                the agent's data_start_date floor via `scope_posts`)
--   p_end      — inclusive upper bound on posted_at; NULL → CURRENT_TIMESTAMP()
--   p_timezone — IANA timezone for the day bucket and dow label; NULL → 'UTC'
--
-- Day bucket = DATE(posted_at, COALESCE(p_timezone, 'UTC')).
-- Channel uniqueness keyed on (platform, channel_handle), same as entity_metrics.
-- Engagement = likes + comments_count + shares + saves.
-- Share-of-voice is computed against totals over the full filtered window.
--
-- Top-N qualitative arrays (each [{value, count}] ordered desc):
--   * top_entities (20), top_themes (20), top_brands (20)
--   * top_content_types (10), top_emotions (10)
--
-- top_channels: top 5 channels by daily engagement →
--   [{handle, platform, channel_type, posts, engagement, views}]
--
-- top_posts: top 5 posts by daily engagement →
--   [{post_id, url, platform, channel_handle, posted_at, content_type,
--     sentiment, ai_summary, engagement, views}]
--
-- custom_fields_stats: same auto-discovery cascade as `entity_metrics` —
-- a JSON object keyed by every top-level custom_fields key observed that day,
-- with type/value-count/numeric-stat summaries.

CREATE OR REPLACE TABLE FUNCTION social_listening.daily_metrics(
    p_agent_id STRING,
    p_start TIMESTAMP,
    p_end TIMESTAMP,
    p_timezone STRING
) AS (
    WITH params AS (
        SELECT
            p_start                                AS start_ts,
            COALESCE(p_end, CURRENT_TIMESTAMP())   AS end_ts,
            COALESCE(p_timezone, 'UTC')            AS tz
    ),
    scoped AS (
        SELECT
            sp.post_id,
            DATE(sp.posted_at, (SELECT tz FROM params)) AS d,
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
    window_totals AS (
        SELECT
            COUNT(post_id)                AS total_posts,
            SUM(COALESCE(views, 0))       AS total_views_all,
            SUM(engagement)               AS total_engagement_all
        FROM scoped
    ),
    -- Day range: start_d is p_start (if given) else first post in the window;
    -- end_d is p_end (defaulted to NOW). Both bucketed in the chosen tz.
    bounds AS (
        SELECT
            DATE(
                COALESCE((SELECT start_ts FROM params),
                         (SELECT MIN(posted_at) FROM scoped)),
                (SELECT tz FROM params)
            ) AS start_d,
            DATE((SELECT end_ts FROM params), (SELECT tz FROM params)) AS end_d
    ),
    dates AS (
        SELECT d
        FROM bounds, UNNEST(GENERATE_DATE_ARRAY(start_d, end_d)) AS d
    ),
    agg AS (
        SELECT
            d,
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
            COUNT(DISTINCT IF(LOWER(channel_type) = 'influencer', channel_key, NULL)) AS unique_channels_influencers
        FROM scoped
        GROUP BY d
    ),
    -- ===================== top-N qualitative breakdowns =====================
    entities_long AS (
        SELECT d, LOWER(TRIM(e)) AS value
        FROM scoped, UNNEST(entities) AS e
        WHERE e IS NOT NULL AND TRIM(e) != ''
    ),
    entity_counts AS (
        SELECT d, value, COUNT(*) AS c
        FROM entities_long
        GROUP BY d, value
    ),
    top_entities_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 20)) AS top_entities
        FROM entity_counts
        GROUP BY d
    ),
    themes_long AS (
        SELECT d, theme AS value
        FROM scoped, UNNEST(themes) AS theme
        WHERE theme IS NOT NULL AND theme != ''
    ),
    theme_counts AS (
        SELECT d, value, COUNT(*) AS c
        FROM themes_long
        GROUP BY d, value
    ),
    top_themes_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 20)) AS top_themes
        FROM theme_counts
        GROUP BY d
    ),
    brands_long AS (
        SELECT d, brand AS value
        FROM scoped, UNNEST(detected_brands) AS brand
        WHERE brand IS NOT NULL AND brand != ''
    ),
    brand_counts AS (
        SELECT d, value, COUNT(*) AS c
        FROM brands_long
        GROUP BY d, value
    ),
    top_brands_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 20)) AS top_brands
        FROM brand_counts
        GROUP BY d
    ),
    content_type_counts AS (
        SELECT d, content_type AS value, COUNT(*) AS c
        FROM scoped
        WHERE content_type IS NOT NULL AND content_type != ''
        GROUP BY d, content_type
    ),
    top_content_types_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 10)) AS top_content_types
        FROM content_type_counts
        GROUP BY d
    ),
    emotion_counts AS (
        SELECT d, emotion AS value, COUNT(*) AS c
        FROM scoped
        WHERE emotion IS NOT NULL AND emotion != ''
        GROUP BY d, emotion
    ),
    top_emotions_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(value, c AS count)
                                 ORDER BY c DESC, value LIMIT 10)) AS top_emotions
        FROM emotion_counts
        GROUP BY d
    ),
    -- ===================== top channels per day =====================
    channel_daily AS (
        SELECT
            d,
            channel_handle,
            ANY_VALUE(platform) AS platform,
            ANY_VALUE(channel_type) AS channel_type,
            COUNT(*) AS posts,
            SUM(engagement) AS engagement,
            SUM(COALESCE(views, 0)) AS views
        FROM scoped
        WHERE channel_handle IS NOT NULL
        GROUP BY d, channel_handle
    ),
    top_channels_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(
                   channel_handle AS handle,
                   platform,
                   channel_type,
                   posts,
                   engagement,
                   views
               ) ORDER BY engagement DESC, posts DESC, channel_handle LIMIT 5)) AS top_channels
        FROM channel_daily
        GROUP BY d
    ),
    -- ===================== top posts per day =====================
    top_posts_ranked AS (
        SELECT
            d, post_id, post_url, platform, channel_handle, posted_at,
            content_type, sentiment, ai_summary, engagement, views,
            ROW_NUMBER() OVER (
                PARTITION BY d
                ORDER BY engagement DESC, COALESCE(views, 0) DESC, post_id
            ) AS _rn
        FROM scoped
    ),
    top_posts_json AS (
        SELECT d,
               TO_JSON(ARRAY_AGG(STRUCT(
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
               ) ORDER BY engagement DESC, COALESCE(views, 0) DESC, post_id LIMIT 5)) AS top_posts
        FROM top_posts_ranked
        WHERE _rn <= 5
        GROUP BY d
    ),
    -- ===================== custom_fields auto-discovery =====================
    -- Mirrors entity_metrics: explode top-level keys per matched post, capture
    -- JSON_TYPE, string view, numeric view; build per-(day, key) summary; merge
    -- into one JSON object per day.
    custom_long AS (
        SELECT s.d, ck AS key,
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
        SELECT d, key, jtype, COUNT(*) AS c
        FROM custom_filtered
        GROUP BY d, key, jtype
    ),
    type_summary AS (
        SELECT d, key,
               ARRAY_AGG(jtype ORDER BY c DESC, jtype LIMIT 1)[OFFSET(0)] AS modal_type,
               COUNT(*) AS distinct_types,
               ARRAY_AGG(STRUCT(jtype AS type, c AS count) ORDER BY c DESC) AS type_counts_arr
        FROM type_counts
        GROUP BY d, key
    ),
    value_counts_raw AS (
        SELECT d, key, sval, COUNT(*) AS c
        FROM custom_filtered
        WHERE sval IS NOT NULL
        GROUP BY d, key, sval
    ),
    top_values AS (
        SELECT d, key,
               ARRAY_AGG(STRUCT(sval AS value, c AS count)
                         ORDER BY c DESC, sval LIMIT 20) AS value_counts_arr,
               COUNT(*) AS n_distinct,
               COUNT(*) > 20 AS truncated,
               SUM(c) AS non_null_count
        FROM value_counts_raw
        GROUP BY d, key
    ),
    numeric_stats AS (
        SELECT d, key,
               COUNT(nval) AS count_numeric,
               AVG(nval) AS mean_v,
               STDDEV_SAMP(nval) AS std_v,
               MIN(nval) AS min_v,
               MAX(nval) AS max_v,
               SUM(nval) AS sum_v,
               APPROX_QUANTILES(nval, 4) AS quartiles
        FROM custom_filtered
        WHERE nval IS NOT NULL
        GROUP BY d, key
    ),
    per_field_json AS (
        SELECT
            ts.d,
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
        LEFT JOIN top_values    tv USING (d, key)
        LEFT JOIN numeric_stats ns USING (d, key)
    ),
    custom_fields_per_day AS (
        SELECT d,
               JSON_OBJECT(ARRAY_AGG(key ORDER BY key),
                           ARRAY_AGG(field_json ORDER BY key)) AS custom_fields_stats
        FROM per_field_json
        GROUP BY d
    )
    SELECT
        d AS date,
        FORMAT_DATE('%a', d) AS dow,
        -- Volume
        COALESCE(a.posts, 0)            AS posts,
        COALESCE(a.total_views, 0)      AS total_views,
        COALESCE(a.total_engagement, 0) AS total_engagement,
        SAFE_DIVIDE(a.total_engagement, a.posts) AS avg_engagement_per_post,
        -- Share of voice vs. full filtered window
        SAFE_DIVIDE(a.posts,            w.total_posts)          AS sov_posts,
        SAFE_DIVIDE(a.total_views,      w.total_views_all)      AS sov_views,
        SAFE_DIVIDE(a.total_engagement, w.total_engagement_all) AS sov_engagement,
        -- Sentiment
        COALESCE(a.pos_mentions, 0) AS pos_mentions,
        COALESCE(a.neg_mentions, 0) AS neg_mentions,
        COALESCE(a.neu_mentions, 0) AS neu_mentions,
        SAFE_DIVIDE(a.pos_mentions - a.neg_mentions, a.posts) AS net_sentiment,
        -- Channels (unique on platform + handle)
        COALESCE(a.unique_channels, 0)             AS unique_channels,
        COALESCE(a.unique_channels_ugc, 0)         AS unique_channels_ugc,
        COALESCE(a.unique_channels_official, 0)    AS unique_channels_official,
        COALESCE(a.unique_channels_media, 0)       AS unique_channels_media,
        COALESCE(a.unique_channels_influencers, 0) AS unique_channels_influencers,
        -- Qualitative top-N (JSON arrays of {value, count})
        tej.top_entities,
        ttj.top_themes,
        tbj.top_brands,
        tctj.top_content_types,
        toej.top_emotions,
        -- Top channels / posts (JSON arrays of structs)
        tcj.top_channels,
        tpj.top_posts,
        -- Custom fields (auto-discovered, JSON)
        cfpd.custom_fields_stats
    FROM dates
    CROSS JOIN window_totals w
    LEFT JOIN agg                    a    USING (d)
    LEFT JOIN top_entities_json      tej  USING (d)
    LEFT JOIN top_themes_json        ttj  USING (d)
    LEFT JOIN top_brands_json        tbj  USING (d)
    LEFT JOIN top_content_types_json tctj USING (d)
    LEFT JOIN top_emotions_json      toej USING (d)
    LEFT JOIN top_channels_json      tcj  USING (d)
    LEFT JOIN top_posts_json         tpj  USING (d)
    LEFT JOIN custom_fields_per_day  cfpd USING (d)
    ORDER BY d
);
