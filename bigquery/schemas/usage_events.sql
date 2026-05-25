-- Canonical schema for the unified usage + cost event log.
--
-- Original 5 event types (chat_message, collection_created, posts_collected,
-- credit_purchase, tool_call) populate the legacy columns only; the cost
-- columns are NULL for them.
--
-- New event types introduced for §A cost telemetry:
--   llm_call       — one row per Gemini / ADK model invocation
--   provider_call  — one row per paid scraping provider call (apify, bright-
--                    data, x_api, vetric)
--   bq_query       — one row per agent-issued BQ query (cost via dry-run bytes)
--   gcs_op         — optional, future: object upload / egress
--
-- Cost is captured as USD * 1e6 (cost_micros) so we never store floats.
-- Source of truth for rates lives in config/cost_rates.py.

CREATE TABLE IF NOT EXISTS social_listening.usage_events (
    event_id STRING NOT NULL,
    event_type STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    session_id STRING,
    collection_id STRING,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),

    -- Cost attribution (added 2026-05-16, §A.0 of PRODUCTION_PLAN.md).
    -- All nullable so legacy rows continue to write without modification.
    provider STRING,            -- gemini | apify | brightdata | x_api | vetric | bq | gcs
    model STRING,               -- LLM model id; NULL for non-LLM rows
    feature STRING,             -- enrich | chat | autonomous | topic_cluster | briefing | dashboard_gen | export | session_naming | wizard | verify_briefing | scrape | bq_query
    input_tokens INT64,
    output_tokens INT64,
    cached_tokens INT64,
    units INT64,                -- posts collected, snapshots, records, bytes
    unit_kind STRING,           -- posts | snapshot | records | bytes
    cost_micros INT64,          -- USD * 1e6 — raw PROVIDER cost
    billed_micros INT64,        -- USD * 1e6 — cost × profit margin; what the wallet is debited (§E, migration 0002)
    agent_id STRING,
    request_id STRING,          -- pairs cost rows with the originating user request

    -- Platform × provider matrix (added 2026-05-24, migration 0003) — each
    -- (provider, platform) pair has its own per-call price (e.g. Apify
    -- charges differently for IG vs FB vs TikTok). NULL for legacy rows
    -- and for rows that aren't platform-scoped (LLM calls, BQ queries).
    platform STRING,            -- instagram | facebook | tiktok | x | reddit | youtube | ...

    -- "Where did `cost_micros` come from" — surfaces in the admin UI so an
    -- operator can tell whether a row reflects the provider's reported
    -- charge, a per-call rate-table lookup, or a fallback estimate
    -- (e.g. apify_assumed_per_post_usd when run.usageTotalUsd is silent).
    cost_source STRING          -- provider_reported | rate_table | estimated_fallback
)
PARTITION BY DATE(created_at)
CLUSTER BY event_type, user_id;
