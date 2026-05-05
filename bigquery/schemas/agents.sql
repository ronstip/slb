-- Append-only / SCD-style table: one row per agent at create time, plus a
-- new row every time `data_start_date` is edited. Readers (notably the
-- scope_posts TVF) take the row with the most recent `created_at`.
CREATE TABLE IF NOT EXISTS social_listening.agents (
    agent_id STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    title STRING NOT NULL,
    data_scope JSON,
    status STRING,
    agent_type STRING,
    data_start_date DATE,
    created_at TIMESTAMP )
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
