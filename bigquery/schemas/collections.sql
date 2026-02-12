CREATE TABLE IF NOT EXISTS social_listening.collections (
    collection_id STRING NOT NULL,
    user_id STRING NOT NULL,
    session_id STRING,
    original_question STRING NOT NULL,
    config JSON NOT NULL,
    created_at TIMESTAMP )
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
