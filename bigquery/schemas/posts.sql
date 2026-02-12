CREATE TABLE IF NOT EXISTS social_listening.posts (
    post_id STRING NOT NULL,
    collection_id STRING NOT NULL,
    platform STRING NOT NULL,
    channel_handle STRING,
    channel_id STRING,
    title STRING,
    content STRING,
    post_url STRING,
    posted_at TIMESTAMP,
    post_type STRING,
    parent_post_id STRING,
    media_refs JSON,
    platform_metadata JSON,
    collected_at TIMESTAMP
)
PARTITION BY DATE(collected_at)
CLUSTER BY collection_id, platform;
