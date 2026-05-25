"""One-time migration (BQ): add `platform` and `cost_source` STRING columns
to ``social_listening.usage_events``.

Why:
    The Finance page needs to break costs down by (provider, platform) —
    Apify charges different per-call prices for Instagram vs Facebook vs
    TikTok, so a single "by provider" row hides the variance. The admin
    Recent Activity view also needs to label whether each priced row came
    from a provider-reported number, a rate-table lookup, or an estimated
    fallback (`apify_assumed_per_post_usd`) — `cost_source` carries that.

Safety / idempotency:
    ALTER TABLE ADD COLUMN IF NOT EXISTS — safe to re-run. Existing rows
    keep their data; the two new columns simply read NULL until a future
    write fills them in.

Usage:
    .\\.venv\\Scripts\\python.exe -m scripts.migrate_usage_events_add_platform_cost_source --dry-run
    .\\.venv\\Scripts\\python.exe -m scripts.migrate_usage_events_add_platform_cost_source
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

from google.cloud import bigquery  # noqa: E402

from config.settings import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("migrate_usage_events_platform_cost_source")


ALTER_SQL = """
ALTER TABLE `{project}.social_listening.usage_events`
    ADD COLUMN IF NOT EXISTS platform STRING,
    ADD COLUMN IF NOT EXISTS cost_source STRING
""".strip()


def main(dry_run: bool) -> None:
    settings = get_settings()
    project = settings.gcp_project_id
    client = bigquery.Client(project=project)

    table_id = f"{project}.social_listening.usage_events"
    table = client.get_table(table_id)
    existing = {f.name for f in table.schema}
    needed = {"platform", "cost_source"} - existing

    if not needed:
        logger.info("usage_events already has `platform` + `cost_source` — nothing to do.")
        return

    sql = ALTER_SQL.format(project=project)
    logger.info("Adding columns to %s: %s", table_id, sorted(needed))
    logger.info("SQL:\n%s", sql)

    if dry_run:
        logger.info("--dry-run: no ALTER issued.")
        return

    job = client.query(sql)
    job.result()
    logger.info("ALTER complete. Verifying…")
    table = client.get_table(table_id)
    have = {f.name for f in table.schema}
    missing = {"platform", "cost_source"} - have
    if missing:
        logger.error("Columns missing after ALTER: %s", missing)
        raise SystemExit(1)
    logger.info("Verified: usage_events now has `platform` and `cost_source`.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Print the ALTER but don't run it.")
    args = p.parse_args()
    main(dry_run=args.dry_run)
