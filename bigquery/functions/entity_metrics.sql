-- entity_metrics TVF.
--
-- Per-entity analysis within a single agent's scoped posts, optionally
-- filtered by time window and platform. For each entity group, returns
-- volume, share-of-voice (vs. full filtered corpus), sentiment breakdown,
-- unique channels by channel_type, average engagement per mention,
-- first/last mention, top content_type, and top emotion.
--
-- Each group has a `canonical` name and a list of `variants` (e.g. ['lakers',
-- 'los angeles lakers', 'lal']). Variants are matched case-insensitively
-- against the `entities` array on `enriched_posts`. A post that mentions
-- multiple variants of the same canonical counts once for that canonical.
--
-- Filters (NULL = no filter / "all"):
--   p_start     — inclusive lower bound on posted_at
--   p_end       — inclusive upper bound on posted_at
--   p_platforms — list of platforms to include; NULL or [] means all
--
-- Channel uniqueness keys on (platform, channel_handle) so the same handle
-- on different platforms is counted as two distinct channels.
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
               sentiment, emotion, content_type,
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
        -- (canonical, post_id) — empty groups preserved as (canonical, NULL).
        SELECT DISTINCT g.canonical, pe.post_id
        FROM UNNEST(p_entity_groups) g
        LEFT JOIN post_entities pe
          ON pe.entity_norm IN UNNEST(
              ARRAY(SELECT LOWER(TRIM(v)) FROM UNNEST(g.variants) v)
          )
    ),
    matched AS (
        SELECT mp.canonical, mp.post_id,
               s.posted_at, s.sentiment, s.emotion, s.content_type,
               s.channel_key, s.channel_type,
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
        te.top_emotion
    FROM agg a
    CROSS JOIN corpus_totals c
    LEFT JOIN top_content_type tct USING (canonical)
    LEFT JOIN top_emotion      te  USING (canonical)
);
