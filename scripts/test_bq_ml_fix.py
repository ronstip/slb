"""Test BQ ML functions without flatten_json_output to discover correct output format."""

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


def test_generate_text_no_flatten():
    """Test AI.GENERATE_TEXT without flatten_json_output."""
    print("=== Test AI.GENERATE_TEXT (no flatten) ===")
    sql = f"""
    SELECT *
    FROM AI.GENERATE_TEXT(
        MODEL `{dataset}.enrichment_model`,
        (SELECT 'Return ONLY this JSON: {{"sentiment": "positive"}}' AS prompt),
        STRUCT(0.2 AS temperature, 256 AS max_output_tokens)
    )
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  SUCCESS — {len(results)} row(s)")
        for row in results:
            row_dict = dict(row)
            print(f"  Column names: {list(row_dict.keys())}")
            for k, v in row_dict.items():
                val_str = str(v)[:300]
                print(f"    {k}: {val_str}")
    except Exception as e:
        print(f"  FAILED — {e}")


def test_generate_embedding_no_flatten():
    """Test AI.GENERATE_EMBEDDING without flatten_json_output."""
    print("\n=== Test AI.GENERATE_EMBEDDING (no flatten) ===")
    sql = f"""
    SELECT *
    FROM AI.GENERATE_EMBEDDING(
        MODEL `{dataset}.embedding_model`,
        (SELECT 'Test embedding sentence.' AS content)
    )
    """
    try:
        job = client.query(sql)
        results = list(job.result())
        print(f"  SUCCESS — {len(results)} row(s)")
        for row in results:
            row_dict = dict(row)
            print(f"  Column names: {list(row_dict.keys())}")
            for k, v in row_dict.items():
                if isinstance(v, list) and len(v) > 5:
                    val_str = f"[{len(v)}-dim vector, first 3: {v[:3]}]"
                elif isinstance(v, dict):
                    val_str = str(v)[:300]
                else:
                    val_str = str(v)[:300]
                print(f"    {k}: {val_str}")
    except Exception as e:
        print(f"  FAILED — {e}")


if __name__ == "__main__":
    print(f"Project: {settings.gcp_project_id}")
    print(f"Dataset: {dataset}\n")
    test_generate_text_no_flatten()
    test_generate_embedding_no_flatten()
