CREATE TABLE IF NOT EXISTS social_listening.topic_cluster_members (
    cluster_id STRING NOT NULL,
    post_id STRING NOT NULL,
    agent_id STRING NOT NULL,
    collection_id STRING NOT NULL,
    distance_to_centroid FLOAT64,
    is_representative BOOL,
    clustered_at TIMESTAMP
)
PARTITION BY DATE(clustered_at)
CLUSTER BY agent_id, cluster_id;
