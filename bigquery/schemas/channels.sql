CREATE TABLE IF NOT EXISTS social_listening.channels (
    channel_id STRING NOT NULL,
    collection_id STRING NOT NULL,
    platform STRING NOT NULL,
    channel_handle STRING NOT NULL,
    subscribers INT64,
    total_posts INT64,
    channel_url STRING,
    description STRING,
    created_date TIMESTAMP,
    channel_metadata JSON,
    observed_at TIMESTAMP )
PARTITION BY DATE(observed_at)
CLUSTER BY platform, channel_handle;
