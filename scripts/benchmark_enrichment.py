"""Enrichment benchmark: measure reliability and performance of the enrichment pipeline.

Deletes existing enrichment data for a collection, re-runs enrichment, and logs
structured metrics to benchmark_results.md for A/B comparison.

Usage:
    uv run python scripts/benchmark_enrichment.py --collection-id <ID> --label "v2-rate-limiting"

A/B workflow:
    uv run python scripts/benchmark_enrichment.py --collection-id <ID> --label "v2-rate-limiting"
    git stash
    uv run python scripts/benchmark_enrichment.py --collection-id <ID> --label "v1-baseline"
    git stash pop
    # → Compare in benchmark_results.md
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))
load_dotenv(project_root / ".env")

LOG_FILE = project_root / "logs" / "worker.log"
RESULTS_FILE = project_root / "benchmark_results.md"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, mode="a"),
    ],
)
logger = logging.getLogger("benchmark")


def _truncate_log():
    """Clear worker.log so metrics only reflect this run."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "w") as f:
        f.truncate(0)
    logger.info("Truncated %s", LOG_FILE)


def _count_posts(bq, collection_id: str) -> int:
    rows = bq.query(
        "SELECT COUNT(*) AS cnt FROM social_listening.posts WHERE collection_id = @collection_id",
        {"collection_id": collection_id},
    )
    return rows[0]["cnt"] if rows else 0


def _count_enriched(bq, collection_id: str) -> int:
    rows = bq.query(
        "SELECT COUNT(*) AS cnt FROM social_listening.enriched_posts ep "
        "JOIN social_listening.posts p ON p.post_id = ep.post_id "
        "WHERE p.collection_id = @collection_id",
        {"collection_id": collection_id},
    )
    return rows[0]["cnt"] if rows else 0


def _delete_enriched(bq, collection_id: str):
    """Delete enriched_posts for this collection only."""
    logger.info("Deleting enriched_posts for collection %s ...", collection_id)
    bq.query(
        "DELETE FROM social_listening.enriched_posts "
        "WHERE post_id IN (SELECT post_id FROM social_listening.posts WHERE collection_id = @collection_id)",
        {"collection_id": collection_id},
    )
    logger.info("Deleted. Waiting 10s for BQ streaming buffer to settle...")
    time.sleep(10)


def _parse_log_metrics() -> dict:
    """Parse worker.log for error/retry counts."""
    metrics = {
        "429_errors": 0,
        "timeout_errors": 0,
        "retries": 0,
        "permanent_failures": 0,
    }
    if not LOG_FILE.exists():
        return metrics

    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "429" in line and ("Too Many Requests" in line or "RESOURCE_EXHAUSTED" in line):
                metrics["429_errors"] += 1
            if "DEADLINE_EXCEEDED" in line or ("504" in line and "ServerError" in line):
                metrics["timeout_errors"] += 1
            if "retrying in" in line.lower():
                metrics["retries"] += 1
            if "failed permanently" in line.lower() or "Enrichment permanently failed" in line:
                metrics["permanent_failures"] += 1

    return metrics


def _ensure_results_file():
    """Create benchmark_results.md with headers if it doesn't exist."""
    if RESULTS_FILE.exists():
        return

    RESULTS_FILE.write_text(
        "# Enrichment Benchmark Results\n"
        "\n"
        "## What this is\n"
        "Automated A/B benchmark for the enrichment pipeline. Comparing original code\n"
        "(baseline) against changes that add rate limiting, jittered retries, and increased\n"
        "timeouts to fix Gemini 429 RESOURCE_EXHAUSTED errors on video content.\n"
        "\n"
        "## Goal\n"
        "- **Reliability**: Enrich 100% of posts (including video/media). Baseline was ~73%.\n"
        "- **Performance**: As fast as possible without sacrificing reliability.\n"
        "- **Media**: All posts must include media in enrichment (YouTube videos, images, etc.)\n"
        "\n"
        "## How to run\n"
        "```\n"
        'uv run python scripts/benchmark_enrichment.py --collection-id <ID> --label "<label>"\n'
        "```\n"
        "\n"
        "## A/B workflow\n"
        '1. Run with current code: `--label "v2-<description>"`\n'
        "2. `git stash` to revert to baseline\n"
        '3. Run with baseline: `--label "v1-baseline"`\n'
        "4. `git stash pop` to restore changes\n"
        "5. Compare rows below\n"
        "\n"
        "## Key files changed (uncommitted)\n"
        "- `workers/enrichment/enricher.py` — token-bucket rate limiters, jittered retries, video detection\n"
        "- `config/settings.py` — new settings (rate limits, retries, concurrency)\n"
        "- `workers/collection/adapters/brightdata.py` — TikTok per-keyword parallel batches\n"
        "- `workers/collection/adapters/brightdata_client.py` — download retry for premature ready\n"
        "- `api/main.py` — startup cleanup of stuck collections\n"
        "\n"
        "## Results\n"
        "\n"
        "| # | Label | Timestamp | Posts | Enriched | Rate % | Duration (s) | 429s | Timeouts | Retries | Failures | s/post |\n"
        "|---|-------|-----------|-------|----------|--------|-------------|------|----------|---------|----------|--------|\n",
        encoding="utf-8",
    )
    logger.info("Created %s", RESULTS_FILE)


def _get_next_run_number() -> int:
    """Count existing result rows to determine next run number."""
    if not RESULTS_FILE.exists():
        return 1
    count = 0
    with open(RESULTS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            # Result rows start with "| <number> |"
            stripped = line.strip()
            if stripped.startswith("|") and not stripped.startswith("| #") and not stripped.startswith("|--"):
                parts = [p.strip() for p in stripped.split("|")]
                if len(parts) > 2 and parts[1].isdigit():
                    count += 1
    return count + 1


def _append_result(label: str, total: int, enriched: int, duration: float, log_metrics: dict):
    """Append a result row to benchmark_results.md."""
    run_num = _get_next_run_number()
    rate = round(enriched / total * 100, 1) if total > 0 else 0
    s_per_post = round(duration / enriched, 1) if enriched > 0 else 0
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    row = (
        f"| {run_num} | {label} | {timestamp} | {total} | {enriched} | {rate} | "
        f"{round(duration)} | {log_metrics['429_errors']} | {log_metrics['timeout_errors']} | "
        f"{log_metrics['retries']} | {log_metrics['permanent_failures']} | {s_per_post} |\n"
    )

    with open(RESULTS_FILE, "a", encoding="utf-8") as f:
        f.write(row)

    return run_num, rate, s_per_post


def main():
    parser = argparse.ArgumentParser(description="Enrichment benchmark")
    parser.add_argument("--collection-id", required=True, help="Collection ID to benchmark")
    parser.add_argument("--label", required=True, help="Label for this run (e.g. 'v1-baseline')")
    args = parser.parse_args()

    from config.settings import get_settings
    from workers.shared.bq_client import BQClient

    settings = get_settings()
    bq = BQClient(settings)

    # Step 1: Clean state
    _truncate_log()

    # Step 2: Count posts
    total_posts = _count_posts(bq, args.collection_id)
    if total_posts == 0:
        print(f"ERROR: No posts found for collection {args.collection_id}")
        sys.exit(1)
    print(f"Collection {args.collection_id}: {total_posts} posts")

    # Step 3: Delete existing enrichment data
    _delete_enriched(bq, args.collection_id)

    # Step 4: Run enrichment
    print(f"\n{'='*60}")
    print(f"Running enrichment (label: {args.label})")
    print(f"{'='*60}\n")

    from workers.enrichment.worker import run_enrichment
    start_time = time.monotonic()
    run_enrichment(args.collection_id)
    duration = time.monotonic() - start_time

    # Step 5: Count results
    enriched = _count_enriched(bq, args.collection_id)

    # Step 6: Parse log metrics
    log_metrics = _parse_log_metrics()

    # Step 7: Write results
    _ensure_results_file()
    run_num, rate, s_per_post = _append_result(args.label, total_posts, enriched, duration, log_metrics)

    # Step 8: Print summary
    print(f"\n{'='*60}")
    print(f"BENCHMARK RESULT (Run #{run_num})")
    print(f"{'='*60}")
    print(f"  Label:            {args.label}")
    print(f"  Total posts:      {total_posts}")
    print(f"  Enriched:         {enriched}")
    print(f"  Rate:             {rate}%")
    print(f"  Duration:         {round(duration)}s ({round(duration/60, 1)} min)")
    print(f"  429 errors:       {log_metrics['429_errors']}")
    print(f"  Timeout errors:   {log_metrics['timeout_errors']}")
    print(f"  Retries:          {log_metrics['retries']}")
    print(f"  Perm. failures:   {log_metrics['permanent_failures']}")
    print(f"  Avg s/post:       {s_per_post}")
    print(f"\nResults appended to {RESULTS_FILE}")


if __name__ == "__main__":
    main()
