"""Shared deduplication SQL fragments for BigQuery queries.

Every table in the pipeline can contain duplicate rows (re-crawls, re-enrichments,
re-embeddings).  These CTEs pick the latest row per post_id so that downstream
queries always operate on a deduplicated dataset.

Posts receive a double-dedup: first within each collection, then globally across
collections (a post can appear in multiple collections).

Usage — as CTEs (parametrised with @collection_ids):

    query = f'''
    {DEDUP_CTES}
    SELECT ...
    FROM deduped_posts p
    LEFT JOIN deduped_enriched    ep ON p.post_id = ep.post_id AND ep._rn = 1
    LEFT JOIN deduped_engagements eng ON p.post_id = eng.post_id AND eng._rn = 1
    LEFT JOIN deduped_embeddings  pe ON p.post_id = pe.post_id AND pe._rn = 1
    '''
"""

# Double-dedup posts: first per (collection_id, post_id), then per post_id globally.
DEDUP_POSTS = """deduped_posts AS (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
            WHERE collection_id IN UNNEST(@collection_ids)
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
)"""

DEDUP_ENRICHED = """deduped_enriched AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
    FROM social_listening.enriched_posts
)"""

DEDUP_ENGAGEMENTS = """deduped_engagements AS (
    SELECT post_id, likes, views, comments_count, shares, saves,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS _rn
    FROM social_listening.post_engagements
)"""

DEDUP_EMBEDDINGS = """deduped_embeddings AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY embedded_at DESC) AS _rn
    FROM social_listening.post_embeddings
)"""

# Convenience: all four CTEs in a single WITH block.
DEDUP_CTES = f"WITH {DEDUP_POSTS},\n{DEDUP_ENRICHED},\n{DEDUP_ENGAGEMENTS},\n{DEDUP_EMBEDDINGS}"
