CREATE TABLE IF NOT EXISTS social_listening.agents (
    agent_id STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    title STRING NOT NULL,
    data_scope JSON,
    status STRING,
    agent_type STRING,
    created_at TIMESTAMP )
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
