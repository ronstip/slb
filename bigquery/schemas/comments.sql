CREATE TABLE IF NOT EXISTS social_listening.comments (
    comment_id STRING NOT NULL,
    post_id STRING NOT NULL,
    agent_id STRING,
    platform STRING NOT NULL,
    root_comment_id STRING,
    channel_handle STRING NOT NULL,
    channel_id STRING,
    content STRING,
    comment_url STRING,
    post_type STRING,
    commented_at TIMESTAMP,
    likes INT64,
    shares INT64,
    replies_count INT64,
    views INT64,
    media_refs JSON,
    platform_metadata JSON,
    crawl_provider STRING,
    fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY post_id, platform;
