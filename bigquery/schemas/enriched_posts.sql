CREATE TABLE IF NOT EXISTS social_listening.enriched_posts (
    post_id STRING NOT NULL,
    sentiment STRING,
    entities ARRAY<STRING>,
    themes ARRAY<STRING>,
    ai_summary STRING,
    language STRING,
    content_type STRING,
    enriched_at TIMESTAMP )
PARTITION BY DATE(enriched_at)
CLUSTER BY post_id;
