CREATE TABLE IF NOT EXISTS social_listening.enriched_posts (
    post_id STRING NOT NULL,
    collection_id STRING,
    agent_id STRING,
    agent_version INT64,
    context STRING,
    sentiment STRING,
    emotion STRING,
    entities ARRAY<STRING>,
    themes ARRAY<STRING>,
    ai_summary STRING,
    language STRING,
    content_type STRING,
    is_related_to_task BOOL,
    detected_brands ARRAY<STRING>,
    channel_type STRING,
    custom_fields JSON,
    enriched_at TIMESTAMP
)
PARTITION BY DATE(enriched_at)
CLUSTER BY post_id, agent_id;

-- Migration for existing tables:
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS emotion STRING;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS custom_fields JSON;
-- ALTER TABLE social_listening.enriched_posts RENAME COLUMN is_related_to_keyword TO is_related_to_task;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS context STRING;
-- ALTER TABLE social_listening.enriched_posts DROP COLUMN IF EXISTS key_quotes;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS collection_id STRING;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS agent_id STRING;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS agent_version INT64;
-- Note: re-clustering by (post_id, agent_id) requires CREATE OR REPLACE on
-- existing tables; new partitions written after the ALTER use the original
-- cluster spec until the table is rewritten. Acceptable for now.
