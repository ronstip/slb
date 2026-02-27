CREATE TABLE IF NOT EXISTS social_listening.usage_events (
    event_id STRING NOT NULL,
    event_type STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    session_id STRING,
    collection_id STRING,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY event_type, user_id;
