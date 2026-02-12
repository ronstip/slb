"""Test BQ ML functions directly to diagnose enrichment/embedding failures.

Runs minimal AI.GENERATE_TEXT and AI.GENERATE_EMBEDDING queries to see
the actual error messages from BigQuery.

Usage:
    uv run python scripts/test_bq_ml.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

project_root = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, project_root)
load_dotenv(Path(project_root) / ".env")

from google.cloud import bigquery

from config.settings import get_settings

settings = get_settings()
client = bigquery.Client(project=settings.gcp_project_id)
dataset = settings.bq_full_dataset


def test_model_exists():
    """Check if the remote models exist."""
    print("=== Check remote models ===")
    for model_name in ["enrichment_model", "embedding_model"]:
        try:
            sql = f"SELECT * FROM ML.PREDICT(MODEL `{dataset}.{model_name}`, (SELECT 1)) LIMIT 0"
            # Actually just check if the model reference resolves
            model_ref = f"{dataset}.{model_name}"
            model = client.get_model(model_ref)
            print(f"  {model_name}: EXISTS (type={model.model_type})")
        except Exception as e:
            print(f"  {model_name}: ERROR — {e}")


def test_generate_text():
    """Test AI.GENERATE_TEXT with a minimal query."""
    print("\n=== Test AI.GENERATE_TEXT ===")
    sql = f"""
    SELECT *
    FROM AI.GENERATE_TEXT(
        MODEL `{dataset}.enrichment_model`,
        (SELECT 'Say hello in JSON format: {{"greeting": "hello"}}' AS prompt),
        STRUCT(0.2 AS temperature, 256 AS max_output_tokens, TRUE AS flatten_json_output)
    )
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  SUCCESS — {len(results)} row(s) returned")
        for row in results:
            row_dict = dict(row)
            for k, v in row_dict.items():
                val_str = str(v)[:200]
                print(f"    {k}: {val_str}")
    except Exception as e:
        print(f"  FAILED — {e}")


def test_generate_text_with_media():
    """Test AI.GENERATE_TEXT with media_uri (multimodal)."""
    print("\n=== Test AI.GENERATE_TEXT with media_uri ===")

    # First check if media_objects table has any data
    try:
        media_check = list(client.query(
            f"SELECT uri FROM `{dataset}.media_objects` LIMIT 3"
        ).result())
        if media_check:
            print(f"  media_objects has data: {[dict(r)['uri'] for r in media_check]}")
        else:
            print("  media_objects is EMPTY — multimodal enrichment won't work")
    except Exception as e:
        print(f"  media_objects check failed: {e}")

    # Test with NULL media_uri (text-only enrichment)
    sql = f"""
    SELECT *
    FROM AI.GENERATE_TEXT(
        MODEL `{dataset}.enrichment_model`,
        (
            SELECT
                'test-post' AS post_id,
                'Analyze this post. Return JSON with sentiment field. Post: I love this skincare product!' AS prompt,
                CAST(NULL AS STRING) AS media_uri
        ),
        STRUCT(0.2 AS temperature, 256 AS max_output_tokens, TRUE AS flatten_json_output)
    )
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  Text-only SUCCESS — {len(results)} row(s)")
        for row in results:
            for k, v in dict(row).items():
                print(f"    {k}: {str(v)[:200]}")
    except Exception as e:
        print(f"  Text-only FAILED — {e}")


def test_generate_embedding():
    """Test AI.GENERATE_EMBEDDING with a minimal query."""
    print("\n=== Test AI.GENERATE_EMBEDDING ===")
    sql = f"""
    SELECT *
    FROM AI.GENERATE_EMBEDDING(
        MODEL `{dataset}.embedding_model`,
        (SELECT 'This is a test sentence for embedding.' AS content),
        STRUCT(TRUE AS flatten_json_output)
    )
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  SUCCESS — {len(results)} row(s) returned")
        for row in results:
            row_dict = dict(row)
            for k, v in row_dict.items():
                if k == "ml_generate_embedding_result":
                    val_str = f"[{len(v)}-dim vector]" if isinstance(v, list) else str(v)[:200]
                else:
                    val_str = str(v)[:200]
                print(f"    {k}: {val_str}")
    except Exception as e:
        print(f"  FAILED — {e}")


def test_actual_enrich_query():
    """Test the actual batch_enrich.sql query (dry run — SELECT only, no INSERT)."""
    print("\n=== Test actual enrichment query (SELECT only, no INSERT) ===")
    sql = f"""
    SELECT
        p.post_id,
        CONCAT(
            'Analyze this social media post. Return ONLY valid JSON.\\n',
            'Fields:\\n',
            '  sentiment: one of positive/negative/neutral/mixed\\n',
            'Post context:\\n',
            'Platform: ', p.platform, '\\n',
            'Text: ', COALESCE(SUBSTR(p.content, 1, 200), '')
        ) AS prompt
    FROM `{dataset}.posts` p
    LEFT JOIN (
        SELECT post_id, likes,
            ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM `{dataset}.post_engagements`
    ) eng ON eng.post_id = p.post_id AND eng.rn = 1
    WHERE COALESCE(eng.likes, 0) >= 30
    LIMIT 3
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  Found {len(results)} posts qualifying for enrichment (likes >= 30)")
        for row in results:
            d = dict(row)
            print(f"    post_id={d['post_id'][:20]}...")
            print(f"    prompt={d['prompt'][:100]}...")
    except Exception as e:
        print(f"  FAILED — {e}")


def main():
    print(f"Project: {settings.gcp_project_id}")
    print(f"Dataset: {dataset}")

    test_model_exists()
    test_generate_text()
    test_generate_text_with_media()
    test_generate_embedding()
    test_actual_enrich_query()

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
