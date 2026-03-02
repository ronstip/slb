CREATE TABLE IF NOT EXISTS social_listening.enriched_posts (
    post_id STRING NOT NULL,
    sentiment STRING,
    emotion STRING,
    entities ARRAY<STRING>,
    themes ARRAY<STRING>,
    ai_summary STRING,
    language STRING,
    content_type STRING,
    key_quotes ARRAY<STRING>,
    custom_fields JSON,
    enriched_at TIMESTAMP
)
PARTITION BY DATE(enriched_at)
CLUSTER BY post_id;

-- Migration for existing tables:
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS emotion STRING;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS key_quotes ARRAY<STRING>;
-- ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS custom_fields JSON;
