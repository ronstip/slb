CREATE TABLE IF NOT EXISTS social_listening.post_embeddings (
    post_id STRING NOT NULL,
    embedding ARRAY<FLOAT64>,
    embedding_model STRING,
    embedded_at TIMESTAMP )
CLUSTER BY post_id;
