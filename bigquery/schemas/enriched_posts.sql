CREATE TABLE IF NOT EXISTS social_listening.enriched_posts (
    post_id STRING NOT NULL,
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
CLUSTER BY post_id;

-- Migration for existing tables:
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS emotion STRING;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS custom_fields JSON;
-- ALTER TABLE social_listening.enriched_posts RENAME COLUMN is_related_to_keyword TO is_related_to_task;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS context STRING;
-- ALTER TABLE social_listening.enriched_posts DROP COLUMN IF EXISTS key_quotes;
