CREATE VECTOR INDEX IF NOT EXISTS post_embedding_index
ON social_listening.post_embeddings(embedding)
OPTIONS (
    index_type = 'IVF',
    distance_type = 'COSINE',
    ivf_options = '{"num_lists": 100}'
);
