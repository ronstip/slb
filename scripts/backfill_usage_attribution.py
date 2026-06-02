r"""One-shot recovery of two classes of unbillable usage_events rows.

Why
---
Two upstream bugs hid real cost from the admin breakdown:

1. **Empty `user_id`** - `workers/collection/adapters/apify.py` (and any other
   direct `cost_meter.log_cost` site that pre-dated the context-fallback in
   `cost_meter.log_cost`) wrote rows with `user_id = ""`. Those rows are real
   spend, but the admin user-detail query (`WHERE user_id = @uid`) hides them.

2. **NULL `cost_micros` for X API** - `crawl_provider = "xapi"` ≠ rate-table
   key `"x_api"` → `compute_cost_micros` returned None → row went in with
   NULL cost. The Finance + UserDetail breakdowns filter
   `cost_micros IS NOT NULL`, so those rows were invisible too.

Both code paths are now patched (`normalize_provider`, log_cost context
fallback). This script recovers the existing BQ rows so admins can see the
historical cost for agents the team was running before the fixes landed.

What it does
------------
Idempotent BQ MERGE-style UPDATEs in two passes:

* **Pass A** - attribution. For rows with `user_id = ''` and a
  `collection_id` we recognise in `social_listening.collections`, set
  `user_id` / `org_id` from the collection's owner.

* **Pass B** - X API cost. For rows with `provider IN ('xapi','x_api')`,
  `cost_micros IS NULL`, and `units > 0`, recompute
  `cost_micros = units * 0.005 USD * 1e6` (the X API search-per-post rate
  from `config/cost_rates.py:120`) and set `billed_micros = cost_micros`
  (margin = 1×).

* **Pass C** - Apify cost. Apify uses `PROVIDER_REPORTED` in the rate
  table, so the legacy `track_posts_collected` path lands `cost_micros =
  NULL` (no provider-reported number passed at that call site). Reprice
  those rows from `units × apify_assumed_per_post_usd` (the same per-post
  estimate the pre-flight gate uses, defined in `config/cost_rates.py`).
  This is an **assumption**, not the exact USD Apify charged us - better
  than NULL for admin attribution, but flag in the UI later if you ever
  want to distinguish "real reported" from "estimated".

Apify rows that were never written (cost-extraction key-path bug in
`apify.py::_run_actor`, fixed separately) cannot be recovered - there's
no row to update for those.

Safety
------
- Idempotent: pass A skips rows that already have user_id; pass B skips
  rows whose cost is already set. Safe to re-run.
- `--dry-run` shows the row counts each pass would touch without writing.

Usage
-----
    .\.venv\Scripts\python.exe -m scripts.backfill_usage_attribution --dry-run
    .\.venv\Scripts\python.exe -m scripts.backfill_usage_attribution
"""

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

from config.cost_rates import COST_RATES, DEFAULT_APIFY_ASSUMED_PER_POST_USD  # noqa: E402
from config.settings import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill_usage_attribution")


# Pulled from the rate table (config/cost_rates.py); kept as constants
# so a future admin override of the runtime rate doesn't silently change
# historical attribution.
_XAPI_SEARCH_RATE_USD = COST_RATES["x_api"]["search_per_post"]["per_unit_usd"]
_APIFY_ASSUMED_RATE_USD = DEFAULT_APIFY_ASSUMED_PER_POST_USD

# Hard cutoff so a future re-run can never re-price rows produced AFTER the
# upstream bugs were fixed. `track_posts_collected` still writes a NULL-cost
# posts_collected row for every Apify batch - the apify adapter's
# provider_call row is the source of truth for cost on those runs. Without
# this cutoff, re-running the script would double-bill those new runs.
# Set to the instant after the original 2026-05-24 backfill execution.
_BACKFILL_CUTOFF_ISO = "2026-05-24T21:00:00Z"


def _cutoff_params() -> bigquery.QueryJobConfig:
    """Bind the backfill cutoff so every pass sees the same horizon."""
    return bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("cutoff", "STRING", _BACKFILL_CUTOFF_ISO),
    ])


def _count_pass_a(client: bigquery.Client) -> int:
    """How many empty-user_id rows can we attribute via collections?

    Cutoff applies - once the upstream fix landed, `cost_meter.log_cost`
    reads user_id from `collection_context_scope`, so legitimate new rows
    can never be empty-user_id. Any new empty rows past the cutoff
    indicate a fresh logging gap that should be fixed at the source.
    """
    sql = """
    SELECT COUNT(*) AS n
    FROM social_listening.usage_events u
    JOIN social_listening.collections c USING (collection_id)
    WHERE (u.user_id IS NULL OR u.user_id = '')
      AND u.collection_id IS NOT NULL
      AND c.user_id IS NOT NULL
      AND c.user_id != ''
      AND u.created_at < TIMESTAMP(@cutoff)
    """
    return int(next(client.query(sql, job_config=_cutoff_params()).result()).n)


def _count_pass_b(client: bigquery.Client) -> int:
    """How many xapi NULL-cost rows can we price from units?"""
    sql = """
    SELECT COUNT(*) AS n
    FROM social_listening.usage_events
    WHERE provider IN ('xapi', 'x_api')
      AND cost_micros IS NULL
      AND units IS NOT NULL
      AND units > 0
      AND created_at < TIMESTAMP(@cutoff)
    """
    return int(next(client.query(sql, job_config=_cutoff_params()).result()).n)


def _run_pass_a(client: bigquery.Client) -> int:
    """Attribute empty user_id rows from their collection's owner."""
    sql = """
    MERGE social_listening.usage_events u
    USING (
        SELECT collection_id, user_id, org_id
        FROM social_listening.collections
        WHERE user_id IS NOT NULL AND user_id != ''
    ) c
    ON u.collection_id = c.collection_id
       AND (u.user_id IS NULL OR u.user_id = '')
       AND u.created_at < TIMESTAMP(@cutoff)
    WHEN MATCHED THEN UPDATE SET
        user_id = c.user_id,
        org_id  = COALESCE(u.org_id, c.org_id)
    """
    job = client.query(sql, job_config=_cutoff_params())
    job.result()  # block
    return job.num_dml_affected_rows or 0


def _count_pass_c(client: bigquery.Client) -> int:
    """How many apify NULL-cost rows can we price from units?

    Cutoff is critical here: post-fix Apify runs write a real-cost
    `provider_call` row PLUS a NULL-cost `posts_collected` row from
    `track_posts_collected`. Without the cutoff a re-run of the script
    would reprice the NULL posts_collected at the assumed rate,
    double-billing every new Apify run on top of its real cost.
    """
    sql = """
    SELECT COUNT(*) AS n
    FROM social_listening.usage_events
    WHERE provider = 'apify'
      AND cost_micros IS NULL
      AND units IS NOT NULL
      AND units > 0
      AND created_at < TIMESTAMP(@cutoff)
    """
    return int(next(client.query(sql, job_config=_cutoff_params()).result()).n)


def _run_pass_b(client: bigquery.Client) -> int:
    """Recompute cost/billed for xapi rows that lost their cost to the
    provider-name mismatch. Margin is hardcoded to 1× - same as the
    runtime default; admins who set a non-1× margin AFTER this backfill
    should adjust the billed_micros via a separate one-shot if they care
    about the historical accounting."""
    sql = """
    UPDATE social_listening.usage_events
    SET
      provider = 'x_api',
      cost_micros = CAST(ROUND(units * @rate * 1000000) AS INT64),
      billed_micros = CAST(ROUND(units * @rate * 1000000) AS INT64)
    WHERE provider IN ('xapi', 'x_api')
      AND cost_micros IS NULL
      AND units IS NOT NULL
      AND units > 0
      AND created_at < TIMESTAMP(@cutoff)
    """
    config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("rate", "FLOAT64", _XAPI_SEARCH_RATE_USD),
            bigquery.ScalarQueryParameter("cutoff", "STRING", _BACKFILL_CUTOFF_ISO),
        ]
    )
    job = client.query(sql, job_config=config)
    job.result()
    return job.num_dml_affected_rows or 0


def _run_pass_c(client: bigquery.Client) -> int:
    """Reprice apify NULL-cost rows from units × assumed-per-post.

    Apify's rate is `PROVIDER_REPORTED` in the rate table, so the legacy
    posts_collected path can't compute cost at write time. We substitute
    the same assumed rate the pre-flight gate uses.
    """
    sql = """
    UPDATE social_listening.usage_events
    SET
      cost_micros = CAST(ROUND(units * @rate * 1000000) AS INT64),
      billed_micros = CAST(ROUND(units * @rate * 1000000) AS INT64)
    WHERE provider = 'apify'
      AND cost_micros IS NULL
      AND units IS NOT NULL
      AND units > 0
      AND created_at < TIMESTAMP(@cutoff)
    """
    config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("rate", "FLOAT64", _APIFY_ASSUMED_RATE_USD),
            bigquery.ScalarQueryParameter("cutoff", "STRING", _BACKFILL_CUTOFF_ISO),
        ]
    )
    job = client.query(sql, job_config=config)
    job.result()
    return job.num_dml_affected_rows or 0


def main(dry_run: bool) -> None:
    settings = get_settings()
    client = bigquery.Client(project=settings.gcp_project_id)
    logger.info("Connected to BigQuery project %s", settings.gcp_project_id)

    # Always count first so the dry-run output and the actual run report
    # the same numbers (counts before the write). Pass C runs BEFORE pass B
    # in the affected-count display because it generally touches more rows;
    # the actual write order doesn't matter - passes are independent.
    n_a = _count_pass_a(client)
    n_b = _count_pass_b(client)
    n_c = _count_pass_c(client)
    logger.info("Pass A - attributable empty-user_id rows: %d", n_a)
    logger.info("Pass B - x_api NULL-cost rows with units:  %d", n_b)
    logger.info("Pass C - apify NULL-cost rows with units:  %d (rate $%.4f/post)",
                n_c, _APIFY_ASSUMED_RATE_USD)

    if dry_run:
        logger.info("Dry run - no rows written. Re-run without --dry-run to apply.")
        return

    if n_a:
        affected_a = _run_pass_a(client)
        logger.info("Pass A complete - %d rows attributed.", affected_a)
    if n_b:
        affected_b = _run_pass_b(client)
        logger.info("Pass B complete - %d rows priced.", affected_b)
    if n_c:
        affected_c = _run_pass_c(client)
        logger.info("Pass C complete - %d rows priced (apify estimate).", affected_c)

    # Re-count after - should be ~0 for all three, confirms idempotency.
    logger.info("After-state - A residual: %d, B residual: %d, C residual: %d",
                _count_pass_a(client), _count_pass_b(client), _count_pass_c(client))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Count only, no writes.")
    args = parser.parse_args()
    main(args.dry_run)
