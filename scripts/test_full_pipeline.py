"""Test the full enrichment pipeline via the worker.

Cleans up any existing enrichment data, then runs the enrichment worker
which executes both batch_enrich.sql and batch_embed.sql.

Usage:
    uv run python scripts/test_full_pipeline.py
"""

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

project_root = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, project_root)
load_dotenv(Path(project_root) / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

from google.cloud import bigquery
from config.settings import get_settings

settings = get_settings()
client = bigquery.Client(project=settings.gcp_project_id, location=settings.gcp_region)
dataset = settings.bq_full_dataset


def run_query(sql: str) -> list[dict]:
    job = client.query(sql)
    return [dict(row) for row in job.result()]


def get_collection_id():
    """Find the collection with the most qualifying posts."""
    rows = run_query(f"""
        SELECT p.collection_id, COUNT(*) AS cnt
        FROM `{dataset}.posts` p
        LEFT JOIN (
            SELECT post_id, likes,
                ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
            FROM `{dataset}.post_engagements`
        ) eng ON eng.post_id = p.post_id AND eng.rn = 1
        WHERE COALESCE(eng.likes, 0) >= 30
        GROUP BY p.collection_id
        ORDER BY cnt DESC
        LIMIT 1
    """)
    if rows:
        cid = rows[0]["collection_id"]
        print(f"Using collection_id: {cid} ({rows[0]['cnt']} qualifying posts)")
        return cid
    return None


def cleanup():
    """Try to clean up old mock/test data."""
    print("=== Cleanup ===")
    try:
        run_query(f"DELETE FROM `{dataset}.enriched_posts` WHERE TRUE")
        print("  Cleared enriched_posts")
    except Exception as e:
        if "streaming buffer" in str(e):
            print("  enriched_posts: streaming buffer still active, skipping delete")
        else:
            print(f"  enriched_posts cleanup failed: {e}")
    try:
        run_query(f"DELETE FROM `{dataset}.post_embeddings` WHERE TRUE")
        print("  Cleared post_embeddings")
    except Exception as e:
        if "streaming buffer" in str(e):
            print("  post_embeddings: streaming buffer still active, skipping delete")
        else:
            print(f"  post_embeddings cleanup failed: {e}")


def run_enrichment_worker(collection_id: str):
    """Run the enrichment worker directly."""
    print(f"\n=== Running enrichment worker for {collection_id} ===")
    from workers.enrichment.worker import run_enrichment
    run_enrichment(collection_id)


def verify():
    """Check final state."""
    print("\n=== Verification ===")
    enriched = run_query(f"""
        SELECT ep.post_id, ep.sentiment, ep.language, ep.content_type,
               SUBSTR(ep.ai_summary, 1, 100) AS summary_preview
        FROM `{dataset}.enriched_posts` ep
        ORDER BY ep.enriched_at DESC
        LIMIT 10
    """)
    print(f"  enriched_posts: {len(enriched)} rows")
    for r in enriched:
        print(f"    {r['post_id'][:16]}... | {r['sentiment']:8s} | {r['language']} | {r['content_type']}")
        print(f"      {r['summary_preview']}")

    embedded = run_query(f"""
        SELECT pe.post_id, pe.embedding_model, ARRAY_LENGTH(pe.embedding) AS dim
        FROM `{dataset}.post_embeddings` pe
        ORDER BY pe.embedded_at DESC
        LIMIT 10
    """)
    print(f"\n  post_embeddings: {len(embedded)} rows")
    for r in embedded:
        print(f"    {r['post_id'][:16]}... | model={r['embedding_model']} | dim={r['dim']}")


def main():
    print(f"Project: {settings.gcp_project_id}")
    print(f"Dataset: {dataset}\n")

    collection_id = get_collection_id()
    if not collection_id:
        print("No qualifying collection found!")
        return

    cleanup()
    run_enrichment_worker(collection_id)
    verify()

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
