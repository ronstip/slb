"""Test offline insertion into enriched_posts and post_embeddings.

Bypasses the BQ ML pipeline (AI.GENERATE_TEXT / AI.GENERATE_EMBEDDING) and
inserts mock rows directly to verify that:
  1. The tables exist and accept inserts
  2. The schema is correct
  3. Downstream queries work with populated data

Usage:
    uv run python scripts/test_offline_enrich.py
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load .env before importing settings
from dotenv import load_dotenv

project_root = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, project_root)
load_dotenv(Path(project_root) / ".env")

from google.cloud import bigquery

from config.settings import get_settings

settings = get_settings()
client = bigquery.Client(project=settings.gcp_project_id)
dataset = settings.bq_full_dataset


def run_query(sql: str) -> list[dict]:
    sql = sql.replace("social_listening.", f"{dataset}.")
    job = client.query(sql)
    return [dict(row) for row in job.result()]


def step_1_check_posts():
    """Check what posts exist and their engagement levels."""
    print("\n=== STEP 1: Check existing posts ===")

    posts = run_query(
        """
        SELECT p.post_id, p.platform, p.collection_id,
               COALESCE(eng.likes, 0) AS likes,
               SUBSTR(COALESCE(p.content, ''), 1, 80) AS content_preview
        FROM social_listening.posts p
        LEFT JOIN (
            SELECT post_id, likes,
                ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
            FROM social_listening.post_engagements
        ) eng ON eng.post_id = p.post_id AND eng.rn = 1
        ORDER BY likes DESC
        LIMIT 20
        """
    )

    if not posts:
        print("  NO POSTS FOUND! Cannot proceed without posts.")
        return []

    print(f"  Found {len(posts)} posts:")
    for p in posts:
        print(f"    {p['post_id'][:20]}... | {p['platform']} | likes={p['likes']} | {p['content_preview']}")

    return posts


def step_2_check_enriched():
    """Check current state of enriched_posts."""
    print("\n=== STEP 2: Check existing enriched_posts ===")
    rows = run_query("SELECT COUNT(*) AS cnt FROM social_listening.enriched_posts")
    print(f"  enriched_posts count: {rows[0]['cnt']}")

    rows = run_query("SELECT COUNT(*) AS cnt FROM social_listening.post_embeddings")
    print(f"  post_embeddings count: {rows[0]['cnt']}")


def step_3_insert_enriched(post_ids: list[str]):
    """Insert mock enrichment rows."""
    print("\n=== STEP 3: Insert mock enriched_posts ===")

    # Check which posts are already enriched
    existing = run_query(
        f"SELECT post_id FROM social_listening.enriched_posts WHERE post_id IN "
        f"({','.join(repr(pid) for pid in post_ids)})"
    )
    existing_ids = {r["post_id"] for r in existing}
    new_ids = [pid for pid in post_ids if pid not in existing_ids]

    if not new_ids:
        print("  All selected posts already enriched, skipping insert.")
        return post_ids

    rows = []
    for pid in new_ids:
        rows.append({
            "post_id": pid,
            "sentiment": "positive",
            "entities": ["test-brand", "test-product"],
            "themes": ["product review", "skincare routine"],
            "ai_summary": f"This is a test enrichment summary for post {pid[:12]}. "
                          "The post discusses skincare products with positive sentiment.",
            "language": "en",
            "content_type": "review",
            "enriched_at": datetime.now(timezone.utc).isoformat(),
        })

    table_ref = f"{dataset}.enriched_posts"
    errors = client.insert_rows_json(table_ref, rows)
    if errors:
        print(f"  INSERT FAILED: {errors}")
        return []
    else:
        print(f"  Inserted {len(rows)} rows into enriched_posts")
        return post_ids


def step_4_insert_embeddings(post_ids: list[str]):
    """Insert mock embedding rows (768-dim zero vector as placeholder)."""
    print("\n=== STEP 4: Insert mock post_embeddings ===")

    existing = run_query(
        f"SELECT post_id FROM social_listening.post_embeddings WHERE post_id IN "
        f"({','.join(repr(pid) for pid in post_ids)})"
    )
    existing_ids = {r["post_id"] for r in existing}
    new_ids = [pid for pid in post_ids if pid not in existing_ids]

    if not new_ids:
        print("  All selected posts already have embeddings, skipping insert.")
        return

    # 768-dim mock embedding (small random-ish values)
    import hashlib
    def mock_embedding(pid: str) -> list[float]:
        """Generate a deterministic pseudo-random 768-dim embedding from post_id."""
        seed = hashlib.sha256(pid.encode()).digest()
        vals = []
        for i in range(768):
            byte_idx = i % len(seed)
            vals.append((seed[byte_idx] - 128) / 256.0)
        return vals

    rows = []
    for pid in new_ids:
        rows.append({
            "post_id": pid,
            "embedding": mock_embedding(pid),
            "embedding_model": "text-embedding-005",
            "embedded_at": datetime.now(timezone.utc).isoformat(),
        })

    table_ref = f"{dataset}.post_embeddings"
    errors = client.insert_rows_json(table_ref, rows)
    if errors:
        print(f"  INSERT FAILED: {errors}")
    else:
        print(f"  Inserted {len(rows)} rows into post_embeddings")


def step_5_verify():
    """Verify the inserted data."""
    print("\n=== STEP 5: Verify inserted data ===")

    enriched = run_query(
        "SELECT post_id, sentiment, ai_summary, enriched_at "
        "FROM social_listening.enriched_posts ORDER BY enriched_at DESC LIMIT 5"
    )
    print(f"  enriched_posts (latest 5):")
    for r in enriched:
        print(f"    {r['post_id'][:20]}... | {r['sentiment']} | {str(r.get('ai_summary',''))[:50]}")

    embeddings = run_query(
        "SELECT post_id, embedding_model, ARRAY_LENGTH(embedding) AS dim, embedded_at "
        "FROM social_listening.post_embeddings ORDER BY embedded_at DESC LIMIT 5"
    )
    print(f"  post_embeddings (latest 5):")
    for r in embeddings:
        print(f"    {r['post_id'][:20]}... | model={r['embedding_model']} | dim={r['dim']}")


def main():
    print(f"Project: {settings.gcp_project_id}")
    print(f"Dataset: {dataset}")

    posts = step_1_check_posts()
    step_2_check_enriched()

    if not posts:
        print("\nNo posts to enrich. Exiting.")
        return

    # Pick up to 3 posts for testing
    test_ids = [p["post_id"] for p in posts[:3]]
    print(f"\nTest post_ids: {test_ids}")

    enriched_ids = step_3_insert_enriched(test_ids)
    if enriched_ids:
        step_4_insert_embeddings(enriched_ids)

    step_5_verify()
    print("\nDone!")


if __name__ == "__main__":
    main()
