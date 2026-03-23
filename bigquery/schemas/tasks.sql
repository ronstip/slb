CREATE TABLE IF NOT EXISTS social_listening.tasks (
    task_id STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    title STRING NOT NULL,
    seed STRING NOT NULL,
    protocol STRING,
    data_scope JSON,
    status STRING,
    task_type STRING,
    created_at TIMESTAMP )
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
