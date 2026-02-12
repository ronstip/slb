CREATE TABLE IF NOT EXISTS social_listening.post_engagements (
    engagement_id STRING NOT NULL,
    post_id STRING NOT NULL,
    likes INT64,
    shares INT64,
    comments_count INT64,
    views INT64,
    saves INT64,
    comments JSON,
    platform_engagements JSON,
    source STRING NOT NULL,
    fetched_at TIMESTAMP )
PARTITION BY DATE(fetched_at)
CLUSTER BY post_id;
