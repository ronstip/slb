-- topic_metrics TVF.
--
-- Per-cluster analytics for an agent's MOST RECENT clustering run. Each row
-- is one topic cluster from that run, with:
--   * identity + LLM-assigned definition (header, subheader, beat_type,
--     keywords, anchor_*)
--   * pre-materialised aggregates from `topic_clusters` (post_count, sentiment
--     counts, engagement totals, extrapolated estimates, recency_score, time
--     range) - these are EXACT at the moment of clustering
--   * query-time aggregates over the cluster's members, computed against
--     enrichment / engagement rows whose timestamps are <= clustered_at
--     (the "as-of-clustered_at" freeze). This eliminates drift from
--     post-clustering re-enrichment or new engagement snapshots, so query-time
--     totals reconcile with the pre-materialised ones.
--   * representative_summaries - JSON array of {post_id, ai_summary} for the
--     cluster's representative posts, in their original order
--   * share-of-voice within the run - denominator is the sum of `estimated_*`
--     across all clusters in this run. SOVs sum to ~1.0 across the run by
--     construction. This is the correct universe: clustering analyses a
--     windowed / post-stratified sample of the agent's corpus, so SOV against
--     `scope_posts` would mix the sampled-pool numerator with an all-time
--     denominator and badly under-report each cluster's share.
--
-- Latest run is picked as MAX(clustered_at) for the agent_id. To inspect a
-- prior run, query `topic_clusters` directly.

CREATE OR REPLACE TABLE FUNCTION social_listening.topic_metrics(
    p_agent_id STRING
) AS (
    WITH latest AS (
        SELECT MAX(clustered_at) AS latest_at
        FROM social_listening.topic_clusters
        WHERE agent_id = p_agent_id
    ),
    clusters AS (
        SELECT *
        FROM social_listening.topic_clusters
        WHERE agent_id = p_agent_id
          AND clustered_at = (SELECT latest_at FROM latest)
    ),
    members_long AS (
        SELECT c.cluster_id, post_id,
               post_id IN UNNEST(c.representative_post_ids) AS is_representative
        FROM clusters c, UNNEST(c.member_post_ids) AS post_id
    ),
    -- ===== AS-OF clustered_at: enrichment + engagement frozen at run time =====
    enr_asof AS (
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
              AND ep.enriched_at <= (SELECT latest_at FROM latest)
        )
        WHERE _rn = 1
    ),
    eng_asof AS (
        SELECT post_id, likes, views, comments_count, shares, saves
        FROM social_listening.post_engagements
        WHERE fetched_at <= (SELECT latest_at FROM latest)
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY post_id ORDER BY fetched_at DESC
        ) = 1
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
    scoped_members AS (
        SELECT
            m.cluster_id,
            m.post_id,
            m.is_representative,
            p.platform,
            p.channel_handle,
            p.title,
            p.posted_at,
            p.media_refs,
            IF(p.channel_handle IS NULL, NULL,
               CONCAT(COALESCE(p.platform, ''), '||', p.channel_handle)) AS channel_key,
            e.sentiment, e.emotion, e.content_type, e.themes, e.entities,
            e.detected_brands, e.channel_type, e.custom_fields, e.ai_summary,
            COALESCE(eg.views, 0) AS views,
            COALESCE(eg.likes, 0) AS likes,
            COALESCE(eg.comments_count, 0) AS comments_count,
            COALESCE(eg.shares, 0) AS shares,
            COALESCE(eg.saves, 0) AS saves,
            (COALESCE(eg.likes, 0) + COALESCE(eg.comments_count, 0)
             + COALESCE(eg.shares, 0) + COALESCE(eg.saves, 0)) AS engagement
        FROM members_long m
        LEFT JOIN dedup_posts p USING (post_id)
        LEFT JOIN enr_asof    e USING (post_id)
        LEFT JOIN eng_asof    eg USING (post_id)
    ),
    -- ===== Run totals for SOV =====
    -- Denominator universe = the run itself: sum of extrapolated estimates
    -- across all clusters. Self-consistent (numerator and denominator are both
    -- full-pool estimates), drift-free, and SOVs sum to ~1.0 across the run.
    run_totals AS (
        SELECT
            SUM(estimated_post_count) AS total_posts,
            SUM(estimated_views)      AS total_views_all,
            SUM(COALESCE(estimated_likes, 0)
              + COALESCE(estimated_comments, 0)
              + COALESCE(estimated_shares, 0)) AS total_engagement_all
        FROM clusters
    ),
    -- ===== Channel / engagement aggregates =====
    agg AS (
        SELECT
            cluster_id,
            SUM(engagement) AS total_engagement_q,
            COUNT(DISTINCT channel_key) AS unique_channels,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'ugc',        channel_key, NULL)) AS unique_channels_ugc,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'official',   channel_key, NULL)) AS unique_channels_official,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'media',      channel_key, NULL)) AS unique_channels_media,
            COUNT(DISTINCT IF(LOWER(channel_type) = 'influencer', channel_key, NULL)) AS unique_channels_influencers
        FROM scoped_members
        GROUP BY cluster_id
    ),
    -- ===== Platform breakdown (posts + views + likes + engagement) =====
    platform_agg AS (
        SELECT cluster_id, platform,
               COUNT(*) AS posts,
               SUM(views) AS views,
               SUM(likes) AS likes,
               SUM(engagement) AS engagement
        FROM scoped_members
        WHERE platform IS NOT NULL
        GROUP BY cluster_id, platform
    ),
    platforms_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(platform, posts, views, likes, engagement)
                                 ORDER BY posts DESC, platform)) AS platforms_breakdown
        FROM platform_agg
        GROUP BY cluster_id
    ),
    -- ===== Top values + value-counts JSON =====
    content_type_counts AS (
        SELECT cluster_id, content_type, COUNT(*) AS c
        FROM scoped_members
        WHERE content_type IS NOT NULL AND content_type != ''
        GROUP BY cluster_id, content_type
    ),
    top_content_type AS (
        SELECT cluster_id,
               ARRAY_AGG(content_type ORDER BY c DESC, content_type LIMIT 1)[OFFSET(0)] AS top_content_type
        FROM content_type_counts
        GROUP BY cluster_id
    ),
    content_type_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(content_type AS value, c AS count)
                                 ORDER BY c DESC, content_type LIMIT 20)) AS content_type_counts
        FROM content_type_counts
        GROUP BY cluster_id
    ),
    themes_long AS (
        SELECT s.cluster_id, theme
        FROM scoped_members s, UNNEST(s.themes) AS theme
        WHERE theme IS NOT NULL AND theme != ''
    ),
    themes_counts AS (
        SELECT cluster_id, theme, COUNT(*) AS c
        FROM themes_long
        GROUP BY cluster_id, theme
    ),
    themes_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(theme AS value, c AS count)
                                 ORDER BY c DESC, theme LIMIT 20)) AS themes_counts
        FROM themes_counts
        GROUP BY cluster_id
    ),
    emotion_counts AS (
        SELECT cluster_id, emotion, COUNT(*) AS c
        FROM scoped_members
        WHERE emotion IS NOT NULL AND emotion != ''
        GROUP BY cluster_id, emotion
    ),
    top_emotion AS (
        SELECT cluster_id,
               ARRAY_AGG(emotion ORDER BY c DESC, emotion LIMIT 1)[OFFSET(0)] AS top_emotion
        FROM emotion_counts
        GROUP BY cluster_id
    ),
    emotion_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(emotion AS value, c AS count)
                                 ORDER BY c DESC, emotion LIMIT 20)) AS emotion_counts
        FROM emotion_counts
        GROUP BY cluster_id
    ),
    entities_long AS (
        SELECT s.cluster_id, LOWER(TRIM(entity)) AS entity
        FROM scoped_members s, UNNEST(s.entities) AS entity
        WHERE entity IS NOT NULL AND TRIM(entity) != ''
    ),
    entities_counts AS (
        SELECT cluster_id, entity, COUNT(*) AS c
        FROM entities_long
        GROUP BY cluster_id, entity
    ),
    entities_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(entity AS value, c AS count)
                                 ORDER BY c DESC, entity LIMIT 20)) AS entities_counts
        FROM entities_counts
        GROUP BY cluster_id
    ),
    brands_long AS (
        SELECT s.cluster_id, LOWER(TRIM(brand)) AS brand
        FROM scoped_members s, UNNEST(s.detected_brands) AS brand
        WHERE brand IS NOT NULL AND TRIM(brand) != ''
    ),
    brands_counts AS (
        SELECT cluster_id, brand, COUNT(*) AS c
        FROM brands_long
        GROUP BY cluster_id, brand
    ),
    brands_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(brand AS value, c AS count)
                                 ORDER BY c DESC, brand LIMIT 20)) AS detected_brands_counts
        FROM brands_counts
        GROUP BY cluster_id
    ),
    channel_type_counts AS (
        SELECT cluster_id, channel_type, COUNT(*) AS c
        FROM scoped_members
        WHERE channel_type IS NOT NULL AND channel_type != ''
        GROUP BY cluster_id, channel_type
    ),
    channel_type_counts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(channel_type AS value, c AS count)
                                 ORDER BY c DESC, channel_type LIMIT 20)) AS channel_type_counts
        FROM channel_type_counts
        GROUP BY cluster_id
    ),
    -- ===== Mass times: timestamps at which cumulative views / engagement
    -- (sorted asc by posted_at) first cross 50% of the cluster total. The
    -- center-of-attention complement to median_post_time, which weights every
    -- post equally.
    mass_ordered AS (
        SELECT cluster_id, posted_at, views, engagement,
               SUM(views) OVER (PARTITION BY cluster_id ORDER BY posted_at
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_views,
               SUM(engagement) OVER (PARTITION BY cluster_id ORDER BY posted_at
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_eng,
               SUM(views) OVER (PARTITION BY cluster_id) AS sum_views,
               SUM(engagement) OVER (PARTITION BY cluster_id) AS sum_eng
        FROM scoped_members
        WHERE posted_at IS NOT NULL
    ),
    mass_times AS (
        SELECT cluster_id,
               MIN(IF(sum_views > 0 AND cum_views >= 0.5 * sum_views,
                      posted_at, NULL)) AS views_mass_time,
               MIN(IF(sum_eng > 0 AND cum_eng >= 0.5 * sum_eng,
                      posted_at, NULL)) AS engagement_mass_time
        FROM mass_ordered
        GROUP BY cluster_id
    ),
    -- ===== Representative posts' AI summaries (order preserved) =====
    rep_summaries AS (
        SELECT c.cluster_id,
               TO_JSON(ARRAY_AGG(STRUCT(rep_id AS post_id, e.ai_summary)
                                 ORDER BY pos)) AS representative_summaries
        FROM clusters c, UNNEST(c.representative_post_ids) AS rep_id WITH OFFSET pos
        LEFT JOIN enr_asof e ON e.post_id = rep_id
        GROUP BY c.cluster_id
    ),
    -- ===== Thumbnail: prefer GCS-backed image, then engagement-weighted =====
    -- UNNESTs media_refs so video-first posts (TikTok/IG Reel/YT Short) still
    -- contribute later image refs instead of being excluded. Filters to
    -- media_type='image' (videos/audio don't render as thumbnails) and
    -- prefers posts with a GCS-backed copy (stable, always renderable);
    -- external-only URLs fall through and are routed via the frontend's
    -- /media-proxy with onError fallback to the styled placeholder.
    thumb_candidates AS (
        SELECT m.cluster_id, m.is_representative, m.views, m.likes,
               JSON_EXTRACT_SCALAR(ref, '$.original_url') AS original_url,
               JSON_EXTRACT_SCALAR(ref, '$.gcs_uri') AS gcs_uri,
               JSON_EXTRACT_SCALAR(ref, '$.media_type') AS media_type
        FROM scoped_members m,
             UNNEST(JSON_QUERY_ARRAY(m.media_refs)) AS ref
        WHERE m.media_refs IS NOT NULL
    ),
    thumb_ranked AS (
        SELECT cluster_id, original_url, gcs_uri,
               ROW_NUMBER() OVER (
                   PARTITION BY cluster_id
                   ORDER BY
                     CASE WHEN gcs_uri IS NOT NULL AND gcs_uri != '' THEN 0 ELSE 1 END,
                     -- Prefer URLs that look like actual image files; many
                     -- parsers populate `original_url` with the post share-link
                     -- (e.g. facebook.com/reel/…, instagram.com/p/…) which the
                     -- frontend cannot render as an <img>.
                     CASE WHEN REGEXP_CONTAINS(LOWER(original_url), r'\.(jpg|jpeg|png|webp|gif)(\?|$)') THEN 0 ELSE 1 END,
                     CASE WHEN REGEXP_CONTAINS(LOWER(original_url), r'/(reel|reels|p|posts|status|video|watch|shorts)/') THEN 1 ELSE 0 END,
                     is_representative DESC,
                     (views + likes * 10) DESC
               ) AS rn
        FROM thumb_candidates
        WHERE media_type = 'image'
          AND (
            (gcs_uri IS NOT NULL AND gcs_uri != '')
            OR (original_url IS NOT NULL AND original_url != '')
          )
    ),
    thumbnails AS (
        SELECT cluster_id, original_url AS thumbnail_url, gcs_uri AS thumbnail_gcs_uri
        FROM thumb_ranked
        WHERE rn = 1
    ),
    -- ===== Sample posts: top-K members per cluster, representative-first.
    -- Engagement weighting matches the legacy briefing loader so callers can
    -- swap to the TVF without behaviour shift.
    sample_ranked AS (
        SELECT cluster_id, post_id, platform, channel_handle, title, ai_summary,
               sentiment, views, likes,
               ROW_NUMBER() OVER (
                   PARTITION BY cluster_id
                   ORDER BY is_representative DESC,
                            (views + likes * 10) DESC
               ) AS rn
        FROM scoped_members
    ),
    sample_posts_json AS (
        SELECT cluster_id,
               TO_JSON(ARRAY_AGG(
                   STRUCT(post_id, platform, channel_handle AS channel,
                          title, ai_summary, sentiment, views, likes)
                   ORDER BY rn
               )) AS sample_posts
        FROM sample_ranked
        WHERE rn <= 10
        GROUP BY cluster_id
    ),
    -- ===== custom_fields auto-discovery (same shape as entity_metrics) =====
    custom_long AS (
        SELECT s.cluster_id, ck AS key,
               JSON_TYPE(s.custom_fields[ck]) AS jtype,
               JSON_VALUE(s.custom_fields[ck]) AS sval,
               SAFE_CAST(JSON_VALUE(s.custom_fields[ck]) AS FLOAT64) AS nval
        FROM scoped_members s,
             UNNEST(JSON_KEYS(s.custom_fields, 1)) AS ck
        WHERE s.custom_fields IS NOT NULL
    ),
    custom_filtered AS (
        SELECT * FROM custom_long
        WHERE jtype IN ('string', 'number', 'boolean')
    ),
    type_counts AS (
        SELECT cluster_id, key, jtype, COUNT(*) AS c
        FROM custom_filtered
        GROUP BY cluster_id, key, jtype
    ),
    type_summary AS (
        SELECT cluster_id, key,
               ARRAY_AGG(jtype ORDER BY c DESC, jtype LIMIT 1)[OFFSET(0)] AS modal_type,
               COUNT(*) AS distinct_types,
               ARRAY_AGG(STRUCT(jtype AS type, c AS count) ORDER BY c DESC) AS type_counts_arr
        FROM type_counts
        GROUP BY cluster_id, key
    ),
    value_counts_raw AS (
        SELECT cluster_id, key, sval, COUNT(*) AS c
        FROM custom_filtered
        WHERE sval IS NOT NULL
        GROUP BY cluster_id, key, sval
    ),
    top_values AS (
        SELECT cluster_id, key,
               ARRAY_AGG(STRUCT(sval AS value, c AS count)
                         ORDER BY c DESC, sval LIMIT 20) AS value_counts_arr,
               COUNT(*) AS n_distinct,
               COUNT(*) > 20 AS truncated,
               SUM(c) AS non_null_count
        FROM value_counts_raw
        GROUP BY cluster_id, key
    ),
    numeric_stats AS (
        SELECT cluster_id, key,
               COUNT(nval) AS count_numeric,
               AVG(nval) AS mean_v,
               STDDEV_SAMP(nval) AS std_v,
               MIN(nval) AS min_v,
               MAX(nval) AS max_v,
               SUM(nval) AS sum_v,
               APPROX_QUANTILES(nval, 4) AS quartiles
        FROM custom_filtered
        WHERE nval IS NOT NULL
        GROUP BY cluster_id, key
    ),
    per_field_json AS (
        SELECT
            ts.cluster_id,
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
        LEFT JOIN top_values    tv USING (cluster_id, key)
        LEFT JOIN numeric_stats ns USING (cluster_id, key)
    ),
    custom_fields_per_cluster AS (
        SELECT cluster_id,
               JSON_OBJECT(ARRAY_AGG(key ORDER BY key),
                           ARRAY_AGG(field_json ORDER BY key)) AS custom_fields_stats
        FROM per_field_json
        GROUP BY cluster_id
    )
    SELECT
        -- Identity & definition
        c.cluster_id,
        c.clustered_at,
        c.algorithm_version,
        c.header,
        c.subheader,
        c.beat_type,
        c.keywords,
        c.anchor_entities,
        c.anchor_themes,
        c.anchor_brands,
        c.anchor_content_types,
        c.member_post_ids,
        c.representative_post_ids,
        -- Pre-materialised aggregates (exact at clustering time)
        c.post_count,
        c.total_views,
        c.total_likes,
        c.total_comments,
        c.total_shares,
        c.positive_count,
        c.negative_count,
        c.neutral_count,
        c.mixed_count,
        c.earliest_post,
        c.median_post_time,
        c.latest_post,
        c.estimated_post_count,
        c.estimated_views,
        c.estimated_likes,
        c.estimated_comments,
        c.estimated_shares,
        SAFE_DIVIDE(c.estimated_post_count, c.post_count) AS blowup_factor,
        c.recency_score,
        -- Composite signal score (matches legacy Python ranking in briefing.py):
        -- recency_score + log1p(total_views)*0.4 + log1p(post_count)*1.5.
        -- Lets callers `ORDER BY signal_score DESC LIMIT N` directly.
        (c.recency_score
         + LN(1 + COALESCE(c.total_views, 0)) * 0.4
         + LN(1 + COALESCE(c.post_count, 0)) * 1.5) AS signal_score,
        -- Derived from pre-materialised
        SAFE_DIVIDE(
            c.positive_count - c.negative_count,
            c.positive_count + c.negative_count + c.neutral_count + c.mixed_count
        ) AS net_sentiment,
        -- Query-time aggregates (as-of clustered_at)
        a.total_engagement_q AS total_engagement,
        SAFE_DIVIDE(a.total_engagement_q, c.post_count) AS avg_engagement_per_post,
        a.unique_channels,
        a.unique_channels_ugc,
        a.unique_channels_official,
        a.unique_channels_media,
        a.unique_channels_influencers,
        -- Mass times (views/engagement weighted)
        mt.views_mass_time,
        mt.engagement_mass_time,
        -- Top values
        tct.top_content_type,
        te.top_emotion,
        -- JSON breakdowns
        pj.platforms_breakdown,
        ctcj.content_type_counts,
        tcj.themes_counts,
        ecj.emotion_counts,
        encj.entities_counts,
        bcj.detected_brands_counts,
        chcj.channel_type_counts,
        -- Representative posts' AI summaries
        rs.representative_summaries,
        -- Top-K sample posts (JSON array; ordered representative-first, then
        -- engagement-weighted). Replaces the legacy `load_topic_posts` loader.
        sp.sample_posts,
        -- Custom fields (auto-discovered, JSON)
        cfpc.custom_fields_stats,
        -- Display helpers
        th.thumbnail_url,
        th.thumbnail_gcs_uri,
        -- Share of voice (within the run; numerators are extrapolated to
        -- match the extrapolated denominator)
        SAFE_DIVIDE(c.estimated_post_count, rt.total_posts)          AS sov_posts,
        SAFE_DIVIDE(c.estimated_views,      rt.total_views_all)      AS sov_views,
        SAFE_DIVIDE(
            COALESCE(c.estimated_likes, 0)
          + COALESCE(c.estimated_comments, 0)
          + COALESCE(c.estimated_shares, 0),
            rt.total_engagement_all
        ) AS sov_engagement
    FROM clusters c
    CROSS JOIN run_totals rt
    LEFT JOIN agg                       a    USING (cluster_id)
    LEFT JOIN platforms_json            pj   USING (cluster_id)
    LEFT JOIN top_content_type          tct  USING (cluster_id)
    LEFT JOIN top_emotion               te   USING (cluster_id)
    LEFT JOIN content_type_counts_json  ctcj USING (cluster_id)
    LEFT JOIN themes_counts_json        tcj  USING (cluster_id)
    LEFT JOIN emotion_counts_json       ecj  USING (cluster_id)
    LEFT JOIN entities_counts_json      encj USING (cluster_id)
    LEFT JOIN brands_counts_json        bcj  USING (cluster_id)
    LEFT JOIN channel_type_counts_json  chcj USING (cluster_id)
    LEFT JOIN mass_times                mt   USING (cluster_id)
    LEFT JOIN rep_summaries             rs   USING (cluster_id)
    LEFT JOIN sample_posts_json         sp   USING (cluster_id)
    LEFT JOIN thumbnails                th   USING (cluster_id)
    LEFT JOIN custom_fields_per_cluster cfpc USING (cluster_id)
);
