CREATE TABLE IF NOT EXISTS social_listening.topic_clusters (
    -- identity
    agent_id STRING NOT NULL,
    cluster_id STRING NOT NULL,
    clustered_at TIMESTAMP NOT NULL,
    algorithm_version STRING,

    -- definition (mirrors Firestore topic doc)
    header STRING,
    subheader STRING,
    beat_type STRING,
    keywords ARRAY<STRING>,
    anchor_entities ARRAY<STRING>,
    anchor_themes ARRAY<STRING>,
    anchor_brands ARRAY<STRING>,
    anchor_content_types ARRAY<STRING>,

    -- membership (sampled posts assigned to this topic)
    member_post_ids ARRAY<STRING>,
    representative_post_ids ARRAY<STRING>,
    post_count INT64,

    -- REAL aggregates over the sampled members
    total_views INT64,
    total_likes INT64,
    total_comments INT64,
    total_shares INT64,
    positive_count INT64,
    negative_count INT64,
    neutral_count INT64,
    mixed_count INT64,
    earliest_post TIMESTAMP,
    median_post_time TIMESTAMP,
    latest_post TIMESTAMP,

    -- EXTRAPOLATED to the full pool. Post count uses the post-stratified
    -- estimator (6-dim signature). Other metrics scale by the per-topic
    -- blowup factor: estimated_post_count / post_count.
    estimated_post_count INT64,
    estimated_views INT64,
    estimated_likes INT64,
    estimated_comments INT64,
    estimated_shares INT64,

    -- ranking
    recency_score FLOAT64
)
PARTITION BY DATE(clustered_at)
CLUSTER BY agent_id, cluster_id;
