-- Migration 0001 - extend usage_events with cost-attribution columns.
--
-- Safe to run live: every new column is nullable, no existing column or
-- type is modified, partitioning and clustering keys are unchanged. Legacy
-- writers (api/services/usage_service.py) continue to work unmodified;
-- their rows simply carry NULL in the new columns.
--
-- Apply with:
--   bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < \
--     bigquery/migrations/0001_usage_events_cost_columns.sql
--
-- (or paste into the BigQuery console, fully-qualified table reference.)
--
-- Rollback: DROP each column. Data in those columns is lost; no impact on
-- legacy event types.

ALTER TABLE social_listening.usage_events
    ADD COLUMN IF NOT EXISTS provider STRING,
    ADD COLUMN IF NOT EXISTS model STRING,
    ADD COLUMN IF NOT EXISTS feature STRING,
    ADD COLUMN IF NOT EXISTS input_tokens INT64,
    ADD COLUMN IF NOT EXISTS output_tokens INT64,
    ADD COLUMN IF NOT EXISTS cached_tokens INT64,
    ADD COLUMN IF NOT EXISTS units INT64,
    ADD COLUMN IF NOT EXISTS unit_kind STRING,
    ADD COLUMN IF NOT EXISTS cost_micros INT64,
    ADD COLUMN IF NOT EXISTS agent_id STRING,
    ADD COLUMN IF NOT EXISTS request_id STRING;
