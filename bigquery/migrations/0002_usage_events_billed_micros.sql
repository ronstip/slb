-- Migration 0002 — add billed_micros to usage_events (§E profit margin).
--
-- `cost_micros` is the raw PROVIDER cost. `billed_micros` is what the user's
-- prepaid wallet is actually debited: provider cost × the admin-set profit
-- margin (config/cost_rates.get_margin_multiplier). Storing it per-row keeps
-- revenue reporting historically accurate even when the margin is changed
-- later, and lets the admin Finance page query cost vs revenue side by side.
--
-- Safe to run live: the column is nullable, no existing column or type is
-- modified, partitioning/clustering keys are unchanged. Legacy rows (and any
-- row whose cost couldn't be priced) keep NULL — treat NULL as "no revenue"
-- in aggregations.
--
-- IMPORTANT: apply this BEFORE deploying the cost_meter change that writes
-- `billed_micros` — BigQuery streaming inserts reject unknown columns.
--
-- Apply with:
--   bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < \
--     bigquery/migrations/0002_usage_events_billed_micros.sql
--
-- (or paste into the BigQuery console, fully-qualified table reference.)
--
-- Rollback: DROP COLUMN billed_micros. Revenue data in that column is lost;
-- no impact on cost_micros or legacy event types.

ALTER TABLE social_listening.usage_events
    ADD COLUMN IF NOT EXISTS billed_micros INT64;
