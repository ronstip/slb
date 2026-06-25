-- Per-comment enrichment, mirroring `enriched_posts` but at COMMENT grain.
--
-- A comment is an enrichable unit like a post: same Gemini enrichment output
-- (sentiment, themes, custom_fields, …), produced with the PARENT post's
-- ai_summary/context injected so a terse answer ("filthy") resolves to the
-- right entity. Append-only; readers dedupe to the latest (comment_id,
-- agent_id, agent_version) via scope_comments().
--
-- Column order after the identity block MUST match enriched_posts so the
-- positional UNION-ALL writer in workers/comments_enrichment/worker.py stays
-- in sync with workers/enrichment/worker.py.
CREATE TABLE IF NOT EXISTS social_listening.enriched_comments (
    comment_id STRING NOT NULL,   -- grain (PK)
    post_id STRING,               -- parent post
    root_comment_id STRING,       -- thread root
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
    relevance_reason STRING,
    is_related_to_task BOOL,
    detected_brands ARRAY<STRING>,
    channel_type STRING,
    custom_fields JSON,
    source STRING,
    enriched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(enriched_at)
CLUSTER BY post_id, agent_id;
