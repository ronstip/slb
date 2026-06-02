"""One-shot backfill: re-attribute Apify cost rows that landed with no
``user_id`` / ``agent_id`` / ``collection_id``.

These are rows logged from inside Apify's per-platform worker threads
during the window where ``threading.Thread`` was still dropping the
``cost_meter`` ContextVar across the parent → child hop (before the
``start_thread_with_cost_context`` helper was wired in at every spawn
site). The row carries the platform (extracted from
``metadata.raw.platform`` by the earlier backfill) but no owner.

Heuristic to recover attribution:

  - For each orphan, look at every ``collection_status`` doc whose
    ``created_at`` is within ``_LOOKBACK_MIN`` minutes BEFORE the orphan
    row and whose ``config.platforms`` is exactly one platform - and
    that platform matches the row.
  - If exactly one matches, stamp ``user_id`` / ``agent_id`` /
    ``collection_id`` from it. If zero or more than one match, skip
    (better to leave orphaned than guess wrong).

Safety / idempotency: only touches rows where the three columns are all
still empty; safe to re-run.

Usage:
    .\\.venv\\Scripts\\python.exe -m scripts.backfill_orphan_apify_rows --dry-run
    .\\.venv\\Scripts\\python.exe -m scripts.backfill_orphan_apify_rows
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
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
logger = logging.getLogger("backfill_orphan_apify")

# An Apify actor run takes seconds to ~minutes after the collection is
# dispatched. 60 minutes is generous - wide enough for slow IG hashtag
# scrapes, tight enough that the next day's collection won't accidentally
# match. We also gate on platform so cross-platform collisions are
# already filtered out.
_LOOKBACK_MIN = 60


def _orphan_apify_rows(bq: bigquery.Client) -> list[dict]:
    return [
        dict(r)
        for r in bq.query(
            """
            SELECT event_id, created_at, platform
            FROM social_listening.usage_events
            WHERE provider = 'apify'
              AND cost_micros IS NOT NULL
              AND (user_id IS NULL OR user_id = '')
              AND agent_id IS NULL
              AND collection_id IS NULL
              AND platform IS NOT NULL
            """
        ).result()
    ]


def _load_single_platform_collections(fs: firestore.Client) -> list[dict]:
    """Stream collection_status docs once, keep only single-platform ones
    (the only kind we can match orphans against unambiguously)."""
    out: list[dict] = []
    for doc in fs.collection("collection_status").stream():
        data = doc.to_dict() or {}
        config = data.get("config") or {}
        platforms = config.get("platforms") or []
        if not isinstance(platforms, list) or len(platforms) != 1:
            continue
        ca = data.get("created_at")
        if not ca or not hasattr(ca, "tzinfo"):
            continue
        out.append({
            "collection_id": doc.id,
            "user_id": data.get("user_id"),
            "agent_id": data.get("agent_id"),
            "platform": platforms[0],
            "created_at": ca,
        })
    return out


def _find_match(
    row: dict, candidates: list[dict],
) -> dict | None:
    """Return the single matching collection or None.

    Match rules: same platform, created within the lookback window ending
    at the row's timestamp. If multiple match, take the most recent (the
    Apify actor for collection N typically completes before collection
    N+1 starts for the same agent, so most-recent-before-row is the
    tightest fit). If none match, return None.
    """
    ts: datetime = row["created_at"]
    plat: str = row["platform"]
    window_start = ts - timedelta(minutes=_LOOKBACK_MIN)
    hits = [
        c for c in candidates
        if c["platform"] == plat
        and window_start <= c["created_at"] <= ts
    ]
    if not hits:
        return None
    hits.sort(key=lambda c: c["created_at"], reverse=True)
    return hits[0]


def main(dry_run: bool) -> None:
    settings = get_settings()
    project = settings.gcp_project_id
    bq = bigquery.Client(project=project)
    fs = firestore.Client(project=project)

    orphans = _orphan_apify_rows(bq)
    logger.info("Found %d orphan apify cost rows.", len(orphans))
    if not orphans:
        return

    candidates = _load_single_platform_collections(fs)
    logger.info("Loaded %d single-platform collections to match against.", len(candidates))

    updates: list[dict] = []
    skipped = 0
    for row in orphans:
        match = _find_match(row, candidates)
        if match is None:
            skipped += 1
            logger.info(
                "  SKIP event_id=%s (no single-platform collection within %dmin before %s on %s)",
                row["event_id"], _LOOKBACK_MIN, row["created_at"], row["platform"],
            )
            continue
        logger.info(
            "  MATCH event_id=%s  → cid=%s uid=%s aid=%s  (%s)",
            row["event_id"], match["collection_id"], match["user_id"],
            match["agent_id"], row["platform"],
        )
        updates.append({
            "event_id": row["event_id"],
            "user_id": match["user_id"],
            "agent_id": match["agent_id"],
            "collection_id": match["collection_id"],
        })

    logger.info("Matched %d / %d orphans (skipped %d).", len(updates), len(orphans), skipped)
    if not updates or dry_run:
        if dry_run:
            logger.info("(dry-run - no MERGE issued)")
        return

    # MERGE-by-event_id so we only touch each orphan once, even if the
    # script is re-run.
    sql = f"""
    MERGE `{project}.social_listening.usage_events` e
    USING UNNEST(@rows) u
    ON e.event_id = u.event_id
       AND (e.user_id IS NULL OR e.user_id = '')
       AND e.agent_id IS NULL
       AND e.collection_id IS NULL
    WHEN MATCHED THEN
        UPDATE SET
            user_id = u.user_id,
            agent_id = u.agent_id,
            collection_id = u.collection_id
    """
    struct_rows = [
        bigquery.StructQueryParameter(
            None,
            bigquery.ScalarQueryParameter("event_id", "STRING", u["event_id"]),
            bigquery.ScalarQueryParameter("user_id", "STRING", u["user_id"]),
            bigquery.ScalarQueryParameter("agent_id", "STRING", u["agent_id"]),
            bigquery.ScalarQueryParameter("collection_id", "STRING", u["collection_id"]),
        )
        for u in updates
    ]
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter("rows", "STRUCT", struct_rows)],
    )
    job = bq.query(sql, job_config=job_config)
    job.result()
    logger.info(
        "Re-attributed %s row(s) (affected: %s).",
        len(updates), job.num_dml_affected_rows,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Show matches without modifying BQ.")
    args = p.parse_args()
    main(dry_run=args.dry_run)
