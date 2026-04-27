CREATE TABLE IF NOT EXISTS social_listening.collections (
    collection_id STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    session_id STRING,
    original_question STRING NOT NULL,
    config JSON NOT NULL,
    task_id STRING,
    time_range_start TIMESTAMP,
    time_range_end TIMESTAMP,
    created_at TIMESTAMP )
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
