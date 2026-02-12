"""Test the fixed batch enrichment and embedding queries against real BQ ML models.

Runs the AI.GENERATE_TEXT and AI.GENERATE_EMBEDDING calls with actual post data
(SELECT only, no INSERT) to verify the fixed SQL syntax works.

Usage:
    uv run python scripts/test_real_enrich.py
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
client = bigquery.Client(project=settings.gcp_project_id, location=settings.gcp_region)
dataset = settings.bq_full_dataset


def run_query(sql: str, params: dict | None = None) -> list[dict]:
    job_config = bigquery.QueryJobConfig()
    if params:
        query_params = []
        for k, v in params.items():
            if isinstance(v, list):
                query_params.append(bigquery.ArrayQueryParameter(k, "STRING", v))
            else:
                query_params.append(bigquery.ScalarQueryParameter(k, "STRING", v))
        job_config.query_parameters = query_params
    job = client.query(sql, job_config=job_config)
    return [dict(row) for row in job.result()]


def test_enrichment_select():
    """Test the enrichment ML call (SELECT only, matching batch_enrich.sql structure)."""
    print("=== Test AI.GENERATE_TEXT with actual post data ===")
    sql = f"""
    SELECT
        result.post_id,
        SAFE.PARSE_JSON(
            REGEXP_REPLACE(
                REGEXP_REPLACE(result.result, r'^```(?:json)?\\s*', ''),
                r'\\s*```\\s*$', ''
            )
        ) AS analysis,
        result.result AS raw_result,
        result.status AS status
    FROM AI.GENERATE_TEXT(
        MODEL `{dataset}.enrichment_model`,
        (
            SELECT
                p.post_id,
                CONCAT(
                    'Analyze this social media post. Return ONLY valid JSON with no markdown formatting.\\n',
                    'Fields:\\n',
                    '  sentiment: one of positive/negative/neutral/mixed\\n',
                    '  entities: array of brands, products, people mentioned\\n',
                    '  themes: array of topic themes (e.g. skincare routine, product review)\\n',
                    '  ai_summary: 2-3 sentence summary of the post\\n',
                    '  language: detected language code (e.g. en, es, he)\\n',
                    '  content_type: one of review/tutorial/meme/ad/unboxing/comparison/testimonial/other\\n',
                    '\\nPost context:\\n',
                    'Platform: ', p.platform, '\\n',
                    'Channel: ', COALESCE(p.channel_handle, 'unknown'), '\\n',
                    'Posted: ', CAST(p.posted_at AS STRING), '\\n',
                    'Title: ', COALESCE(p.title, ''), '\\n',
                    'Text: ', COALESCE(p.content, '')
                ) AS prompt
            FROM `{dataset}.posts` p
            LIMIT 1
        ),
        STRUCT(0.2 AS temperature, 2048 AS max_output_tokens)
    ) AS result
    """
    try:
        results = run_query(sql)
        print(f"  SUCCESS! {len(results)} row(s)")
        for row in results:
            print(f"  post_id: {row['post_id'][:20]}...")
            print(f"  raw LLM output: {str(row['raw_result'])[:300]}")
            print(f"  status: {row['status']}")
            analysis = row.get("analysis")
            if analysis:
                print(f"  parsed JSON keys: {list(analysis.keys()) if isinstance(analysis, dict) else type(analysis)}")
                if isinstance(analysis, dict):
                    for k, v in analysis.items():
                        print(f"    {k}: {str(v)[:100]}")
            else:
                print("  WARNING: PARSE_JSON returned NULL — regex may need adjustment")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def test_embedding_select():
    """Test the embedding ML call (SELECT only, matching batch_embed.sql structure)."""
    print("\n=== Test AI.GENERATE_EMBEDDING with enriched post data ===")

    # First check if we have enriched posts (from our mock insert)
    enriched = run_query(
        "SELECT post_id, ai_summary, sentiment, themes "
        "FROM social_listening.enriched_posts WHERE ai_summary IS NOT NULL LIMIT 1"
    )
    if not enriched:
        print("  No enriched posts available for embedding test. Skipping.")
        # Use a synthetic test instead
        print("\n  Running synthetic embedding test instead...")
        sql = f"""
        SELECT
            result.embedding,
            result.status,
            ARRAY_LENGTH(result.embedding) AS dim
        FROM AI.GENERATE_EMBEDDING(
            MODEL `{dataset}.embedding_model`,
            (SELECT 'This post discusses a positive skincare review with themes of product review and skincare routine' AS content)
        ) AS result
        """
        try:
            results = run_query(sql)
            print(f"  SUCCESS! {len(results)} row(s)")
            for row in results:
                print(f"    dim={row['dim']}, status={row['status']}")
            return True
        except Exception as e:
            print(f"  FAILED: {e}")
            return False

    ep = enriched[0]
    print(f"  Using enriched post: {ep['post_id'][:20]}...")

    sql = f"""
    SELECT
        result.post_id,
        result.embedding,
        result.status,
        ARRAY_LENGTH(result.embedding) AS dim
    FROM AI.GENERATE_EMBEDDING(
        MODEL `{dataset}.embedding_model`,
        (
            SELECT
                ep.post_id,
                CONCAT(
                    ep.ai_summary, ' | ',
                    'sentiment: ', ep.sentiment, ' | ',
                    'themes: ', ARRAY_TO_STRING(ep.themes, ', ')
                ) AS content
            FROM `{dataset}.enriched_posts` ep
            WHERE ep.post_id = @test_post_id
        )
    ) AS result
    """
    try:
        results = run_query(sql, {"test_post_id": ep["post_id"]})
        print(f"  SUCCESS! {len(results)} row(s)")
        for row in results:
            print(f"    post_id={row['post_id'][:20]}... | dim={row['dim']} | status={row['status']}")
        return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False


def main():
    print(f"Project: {settings.gcp_project_id}")
    print(f"Dataset: {dataset}\n")

    enrich_ok = test_enrichment_select()
    embed_ok = test_embedding_select()

    print("\n=== Summary ===")
    print(f"  Enrichment (AI.GENERATE_TEXT): {'PASS' if enrich_ok else 'FAIL'}")
    print(f"  Embedding (AI.GENERATE_EMBEDDING): {'PASS' if embed_ok else 'FAIL'}")


if __name__ == "__main__":
    main()
