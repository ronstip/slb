"""One-time backfill: fill `agent_id`, `platform`, and `cost_source` on
the existing rows of ``social_listening.usage_events``.

Why:
    The new columns from migration 0003 (platform, cost_source) start NULL
    on every pre-existing row. Same for `agent_id` on rows logged before
    the cost-meter ContextVar thread-propagation fix landed — Apify /
    X API / posts_collected events fired from worker sub-threads dropped
    the agent_id because plain `threading.Thread` doesn't inherit
    ContextVars.

    Without this backfill the admin Recent Activity panel still groups
    every legacy crawler row under "Unassigned" instead of the agent that
    actually paid for them, and the Finance "By cost source" + matrix
    cards stay full of "unknown" buckets.

What it does (each step is idempotent + safe to re-run):

1. **agent_id** — for every row with `agent_id IS NULL` AND a non-null
   `collection_id`, look up the collection's agent_id from Firestore
   (`collection_status/<id>.agent_id`) and `MERGE` it in.

2. **platform** — Apify rows stored the platform in the raw provider
   payload (`metadata.raw.platform`). Extract it via JSON nav. For rows
   where that isn't present, fall back to the collection's single
   platform when the collection had exactly one — multi-platform
   collections stay NULL (we don't know which one each row was for).

3. **cost_source** — deterministic by provider:
   - apify rows with a non-null cost_micros: `provider_reported` (the
     adapter only logged when `run.usageTotalUsd` was set, until today's
     fallback path).
   - gemini / google_search / brightdata / x_api / vetric / bq / gcs
     rows with a non-null cost_micros: `rate_table` (looked up via
     `config.cost_rates`).
   - cost_micros NULL: leave NULL (no cost, no source).

Usage:
    .\\.venv\\Scripts\\python.exe -m scripts.backfill_usage_events_platform_cost_source --dry-run
    .\\.venv\\Scripts\\python.exe -m scripts.backfill_usage_events_platform_cost_source
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from google.cloud import bigquery, firestore  # noqa: E402

from config.settings import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill_usage_events")


# Providers whose cost we compute from the rate table at log time.
# Apify is the only PROVIDER_REPORTED provider in the codebase today.
_RATE_TABLE_PROVIDERS = (
    "gemini",
    "google_search",
    "brightdata",
    "x_api",
    "xapi",       # legacy spelling — still present in older rows
    "vetric",
    "bq",
    "gcs",
)


def load_collection_meta(db: firestore.Client) -> dict[str, dict]:
    """Stream every `collection_status` doc once.

    Returns a `{collection_id: {agent_id, platforms[]}}` map for downstream
    BQ joins. Streaming via .stream() is one round-trip per ~500 docs so
    even a few thousand collections are fast (seconds).
    """
    out: dict[str, dict] = {}
    for doc in db.collection("collection_status").stream():
        data = doc.to_dict() or {}
        agent_id = data.get("agent_id")
        config = data.get("config") or {}
        platforms = config.get("platforms") or []
        if isinstance(platforms, list):
            platforms = [p for p in platforms if isinstance(p, str) and p]
        else:
            platforms = []
        out[doc.id] = {"agent_id": agent_id, "platforms": platforms}
    return out


def backfill_agent_id(bq_client: bigquery.Client, project: str, meta: dict[str, dict], dry_run: bool) -> None:
    """MERGE collection_id → agent_id from Firestore into usage_events.

    Skips rows that already have an agent_id (most rows logged from chat-
    side stamp it explicitly via ADK callbacks). Only fills the gap left
    by worker-thread rows where the ContextVar didn't propagate.
    """
    rows = [
        {"collection_id": cid, "agent_id": m["agent_id"]}
        for cid, m in meta.items()
        if m.get("agent_id")
    ]
    if not rows:
        logger.info("agent_id backfill: no (collection_id → agent_id) mappings — nothing to do.")
        return

    sql = f"""
    MERGE `{project}.social_listening.usage_events` e
    USING UNNEST(@rows) c
    ON e.collection_id = c.collection_id AND e.agent_id IS NULL
    WHEN MATCHED THEN
        UPDATE SET agent_id = c.agent_id
    """
    logger.info("agent_id backfill: %d collection mappings", len(rows))
    if dry_run:
        logger.info("  (dry-run, skipping execution)")
        return

    struct_rows = [
        bigquery.StructQueryParameter(
            None,
            bigquery.ScalarQueryParameter("collection_id", "STRING", r["collection_id"]),
            bigquery.ScalarQueryParameter("agent_id", "STRING", r["agent_id"]),
        )
        for r in rows
    ]
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("rows", "STRUCT", struct_rows)],
    )
    job = bq_client.query(sql, job_config=job_config)
    job.result()
    logger.info("  agent_id MERGE complete (affected rows: %s)", job.num_dml_affected_rows)


def backfill_platform_from_metadata(bq_client: bigquery.Client, project: str, dry_run: bool) -> None:
    """For Apify rows, extract `platform` from the JSON metadata payload.

    The adapter passes the platform on every cost row via
    `raw_provider_payload["platform"]`, which `cost_meter.log_cost`
    serialises into `metadata.raw` (a string-encoded JSON nested inside
    the JSON column). PARSE_JSON peels the inner string before
    JSON_VALUE pulls the platform field.
    """
    sql = f"""
    UPDATE `{project}.social_listening.usage_events`
    SET platform = JSON_VALUE(SAFE.PARSE_JSON(JSON_VALUE(metadata, '$.raw')), '$.platform')
    WHERE provider = 'apify'
      AND platform IS NULL
      AND metadata IS NOT NULL
      AND JSON_VALUE(metadata, '$.raw') IS NOT NULL
    """
    logger.info("platform backfill (apify, from metadata.raw.platform)")
    if dry_run:
        logger.info("  (dry-run, skipping execution)")
        return
    job = bq_client.query(sql)
    job.result()
    logger.info("  apify platform fill complete (affected rows: %s)", job.num_dml_affected_rows)


def backfill_platform_from_collection(
    bq_client: bigquery.Client, project: str, meta: dict[str, dict], dry_run: bool,
) -> None:
    """For rows with a collection that targeted exactly one platform,
    stamp that platform. Multi-platform collections stay NULL — we can't
    confidently attribute a given row to one of several platforms.
    """
    single = [
        {"collection_id": cid, "platform": m["platforms"][0]}
        for cid, m in meta.items()
        if len(m.get("platforms") or []) == 1
    ]
    if not single:
        logger.info("platform backfill (single-platform collections): nothing to do.")
        return

    sql = f"""
    MERGE `{project}.social_listening.usage_events` e
    USING UNNEST(@rows) c
    ON e.collection_id = c.collection_id AND e.platform IS NULL
    WHEN MATCHED THEN
        UPDATE SET platform = c.platform
    """
    logger.info(
        "platform backfill (single-platform collections): %d collections",
        len(single),
    )
    if dry_run:
        logger.info("  (dry-run, skipping execution)")
        return

    struct_rows = [
        bigquery.StructQueryParameter(
            None,
            bigquery.ScalarQueryParameter("collection_id", "STRING", r["collection_id"]),
            bigquery.ScalarQueryParameter("platform", "STRING", r["platform"]),
        )
        for r in single
    ]
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("rows", "STRUCT", struct_rows)],
    )
    job = bq_client.query(sql, job_config=job_config)
    job.result()
    logger.info("  platform MERGE complete (affected rows: %s)", job.num_dml_affected_rows)


def backfill_cost_source(bq_client: bigquery.Client, project: str, dry_run: bool) -> None:
    """Deterministic per-provider cost_source labels for legacy rows."""
    rate_table_list = "', '".join(_RATE_TABLE_PROVIDERS)
    sql = f"""
    UPDATE `{project}.social_listening.usage_events`
    SET cost_source = CASE
        WHEN provider = 'apify' AND cost_micros IS NOT NULL THEN 'provider_reported'
        WHEN provider IN ('{rate_table_list}') AND cost_micros IS NOT NULL THEN 'rate_table'
        ELSE cost_source
    END
    WHERE cost_source IS NULL AND cost_micros IS NOT NULL
    """
    logger.info("cost_source backfill (provider-rule based)")
    if dry_run:
        logger.info("  (dry-run, skipping execution)")
        return
    job = bq_client.query(sql)
    job.result()
    logger.info("  cost_source UPDATE complete (affected rows: %s)", job.num_dml_affected_rows)


def main(dry_run: bool) -> None:
    settings = get_settings()
    project = settings.gcp_project_id
    fs_client = firestore.Client(project=project)
    bq_client = bigquery.Client(project=project)

    logger.info("Loading collection_status from Firestore…")
    meta = load_collection_meta(fs_client)
    logger.info("  %d collections loaded.", len(meta))

    backfill_agent_id(bq_client, project, meta, dry_run)
    backfill_platform_from_metadata(bq_client, project, dry_run)
    backfill_platform_from_collection(bq_client, project, meta, dry_run)
    backfill_cost_source(bq_client, project, dry_run)

    logger.info("Backfill complete (dry_run=%s).", dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Show the steps and counts without modifying BQ.")
    args = p.parse_args()
    main(dry_run=args.dry_run)
