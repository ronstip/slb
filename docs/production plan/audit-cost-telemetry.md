# Cost Telemetry Audit — §A.0 of `PRODUCTION_PLAN.md`

Purpose: produce a complete map of (a) what we track today, (b) every paid external call that goes out untracked, (c) the schema shape needed to capture cost. No code changes yet — this is the input to the §A implementation pass.

Audit date: 2026-05-16. Re-run before coding if more than ~2 weeks elapse.

---

## What we track today

Source of truth: [api/services/usage_service.py](../api/services/usage_service.py) (135 lines, single module, threaded fire-and-forget writes to BQ + Firestore counters).

Five public functions, five `event_type` values landing in `usage_events`:

| `event_type` | Caller | Fields captured | Fields missing for cost attribution |
|---|---|---|---|
| `chat_message` | [api/routers/chat.py:70](../api/routers/chat.py#L70) | `user_id`, `org_id`, `session_id` | no token counts, no model, no cost |
| `collection_created` | [api/services/collection_service.py:134](../api/services/collection_service.py#L134) | + `collection_id` | n/a (creation is free; cost arrives later as scraping + enrichment) |
| `posts_collected` | [workers/pipeline/runner.py](../workers/pipeline/runner.py) (called from pipeline steps) | + `metadata.count` | **no provider** — cannot attribute cost to apify vs brightdata vs vetric vs x_api |
| `credit_purchase` | [api/routers/billing.py](../api/routers/billing.py) | + `metadata.credits, amount_cents, pack_id` | n/a (revenue side) |
| `tool_call` | [api/agent/callbacks.py:1107](../api/agent/callbacks.py#L1107) | + `tool_name`, `status` | no LLM token counts even when the tool wraps a Gemini call |

Schema today — [bigquery/schemas/usage_events.sql](../bigquery/schemas/usage_events.sql):

```sql
event_id, event_type, user_id, org_id, session_id, collection_id, metadata JSON, created_at
```

Partitioned by `DATE(created_at)`, clustered by `event_type, user_id`. Solid foundation; only thing missing is *the cost-bearing fields*.

---

## What we do NOT track (every untracked paid call site)

### LLM — Gemini (`client.models.generate_content`)

`usage_metadata` is **never** read or persisted anywhere in the codebase (verified — zero grep hits for `usage_metadata|prompt_token_count|candidates_token_count|total_token_count` outside this doc). Each of these calls leaks tokens with zero attribution:

| File | Line | Feature tag | Volume hint |
|---|---|---|---|
| [workers/enrichment/enricher.py](../workers/enrichment/enricher.py) | 533 | `enrich` | **highest volume** — per-post call, batched, runs across every collection |
| [workers/topics/taxonomy.py](../workers/topics/taxonomy.py) | 103, 321, 519 | `topic_cluster` | 3 calls per cluster cycle |
| [workers/clustering/labeler.py](../workers/clustering/labeler.py) | (multiple) | `cluster_label` | per cluster |
| [workers/pipeline/steps.py](../workers/pipeline/steps.py) | (multiple) | varies — confirm at instrumentation time | per post or per step |
| [api/agent/agent.py:199-209](../api/agent/agent.py#L199-L209) | via ADK `LlmAgent` | `chat` / `autonomous` | every chat turn + sub-agents (google_search_agent) |
| [api/routers/topics.py:273](../api/routers/topics.py#L273) | | `topics_endpoint` | on-demand |
| [api/routers/dashboard.py:319](../api/routers/dashboard.py#L319) | | `dashboard_gen` | on-demand |
| [api/routers/posts.py:359](../api/routers/posts.py#L359) | | `posts_endpoint` | on-demand |
| [api/services/session_naming.py:43](../api/services/session_naming.py#L43) | | `session_naming` | once per new chat session |
| [api/agent/interpreters/wizard_planner.py:198](../api/agent/interpreters/wizard_planner.py#L198) | | `wizard` | once per wizard run |
| [api/agent/tools/verify_briefing.py:295](../api/agent/tools/verify_briefing.py#L295) | | `verify_briefing` | once per publish |

Out of scope for prod cost tracking: [api/agent/evals/judge.py](../api/agent/evals/judge.py) (eval), [scripts/refresh_briefing.py](../scripts/refresh_briefing.py) (script), [workers/collection/adapters/mock_adapter.py](../workers/collection/adapters/mock_adapter.py) (mock).

**Capture target per call** — `response.usage_metadata.prompt_token_count`, `candidates_token_count`, `total_token_count`, `cached_content_token_count` if present, plus `response.model_version` (the actual served model can differ from requested).

**ADK callback path** — the agent invocations in `api/agent/agent.py` go through ADK's `LlmAgent`. ADK exposes `after_model_callback(callback_context, llm_response)` where `llm_response.usage_metadata` is available. Hook there in [api/agent/callbacks.py](../api/agent/callbacks.py) — single chokepoint covers both `chat` mode and the autonomous executor + every sub-agent (e.g. `google_search_agent`).

### Scraping providers — per-post cost

`track_posts_collected` does count posts but **does not carry the provider name**. Without provider, we cannot price an apify Instagram post against a brightdata Reddit post against an X API tweet. This is a one-line API change to `usage_service.track_posts_collected(...)` plus all call sites — the meter is already running, it just needs a label.

Per-provider data already returned by the client wrappers (free for the taking, just not currently captured):

| Provider | File | Cost-bearing data the provider returns |
|---|---|---|
| Apify | [workers/collection/adapters/apify_client.py:57](../workers/collection/adapters/apify_client.py#L57) | Run object exposes `usage.cost` (USD) + `runtime` / `memoryMbytes`. Cost is **exact** — capture `usage.cost` directly, no markup math needed. |
| BrightData | [workers/collection/adapters/brightdata_client.py:71-225](../workers/collection/adapters/brightdata_client.py#L71-L225) | `snapshot_id`, `dataset_id`, record count after `download_snapshot`. Cost is per-record per-dataset — model in `cost_rates.py`. |
| X API | [workers/collection/adapters/x_api_client.py](../workers/collection/adapters/x_api_client.py) | Tweet count + endpoint. Cost is per-tweet at the X v2 enterprise tier — model in `cost_rates.py`. |
| Vetric | [workers/collection/adapters/vetric_client.py](../workers/collection/adapters/vetric_client.py) | Per-call cost from contracted rate — model in `cost_rates.py`. |

All four adapters are called from the pipeline normalizer / wrapper layer; instrument once at the wrapper boundary ([workers/collection/wrapper.py](../workers/collection/wrapper.py)) so a single `log_cost(...)` call covers every provider.

### Misc paid signals (lower priority but cheap to add)

- **GCS egress / storage** — `{project}-media` + `{project}-exports`. Capture object size on upload; bill from BQ via daily aggregation.
- **BigQuery slot cost** — agent `execute_sql` calls are unmetered. `dry_run` before each query gets `total_bytes_processed`; multiply by on-demand $/TB. Today there's a 120-query cap per session ([api/agent/callbacks.py:161](../api/agent/callbacks.py#L161)) which bounds blast radius but doesn't measure it.

---

## Schema decision

**Recommendation: extend `usage_events`, do not split into a sibling `cost_events` table.**

Rationale: every cost row is also a product event (a tool call, a post collected, a chat turn). Splitting forces a join for every meaningful question ("show me chat sessions that cost more than $1"). The cost fields are all nullable for non-paid events; partitioning + clustering stays optimal. Future: if `usage_events` ever crosses ~100 GB and provider-only queries dominate, materialize a `cost_events` view then.

**Additive columns** (no breaking changes; existing 5 event types continue to write `NULL` for cost fields):

```sql
ALTER TABLE social_listening.usage_events
  ADD COLUMN provider STRING,           -- gemini | apify | brightdata | x_api | vetric | bq | gcs
  ADD COLUMN model STRING,              -- gemini model id, null for non-LLM
  ADD COLUMN feature STRING,            -- enrich | chat | autonomous | topic_cluster | briefing | dashboard_gen | export | session_naming | wizard | verify_briefing | scrape
  ADD COLUMN input_tokens INT64,
  ADD COLUMN output_tokens INT64,
  ADD COLUMN cached_tokens INT64,
  ADD COLUMN units INT64,               -- posts collected, snapshots, records — non-LLM volume metric
  ADD COLUMN unit_kind STRING,          -- posts | snapshot | records | bytes
  ADD COLUMN cost_micros INT64,         -- USD * 1e6, computed at insert time from cost_rates
  ADD COLUMN agent_id STRING,
  ADD COLUMN request_id STRING;         -- pairs rows with the log trace
```

Also extend `event_type` enum (informally — STRING column) with: `llm_call`, `provider_call`. The existing 5 stay; new rows for cost-only events use the new types.

**`cost_micros` calc** lives in a new `config/cost_rates.py` rate table — single source of truth:

```python
COST_RATES = {
  "gemini": {
    "gemini-3-flash-preview": {"input_per_mtok": 0.075, "output_per_mtok": 0.30, "cached_per_mtok": 0.01875},
    # ...other models, fallback "*" entry
  },
  "apify": "use_provider_reported",     # apify run.usage.cost is exact
  "brightdata": {                       # per-record by dataset
    "gd_lk1g3l1g3vk1g3vk1g3v": 0.001,   # Instagram example — placeholder, fill from invoice
    # ...
  },
  "x_api": {"search_per_post": 0.002, "lookup_per_call": 0.001},
  "vetric": {"per_call": 0.0005},
  "bq": {"per_tb_processed": 5.0},
  "gcs": {"per_gb_stored": 0.020, "per_gb_egress": 0.12},
}
```

Numbers above are **placeholders** — populate from the actual provider invoices before relying on the dashboard. The point is the *shape* and that drift is a one-file change.

---

## Implementation order (when we start writing code)

1. **Schema migration** — additive `ALTER TABLE`. Safe to run live (no backfill). Update [bigquery/schemas/usage_events.sql](../bigquery/schemas/usage_events.sql) to match.
2. **`config/cost_rates.py`** — placeholder values with `# TODO: confirm from <provider> invoice` comments.
3. **`api/services/cost_meter.py`** — single `log_cost(...)` function. Reuse the threaded-insert pattern from [api/services/usage_service.py:102-134](../api/services/usage_service.py#L102-L134). Failure to log NEVER blocks the caller.
4. **Extend `track_posts_collected` to take `provider: str`** — touches the function + every caller in [workers/pipeline/runner.py](../workers/pipeline/runner.py) and pipeline steps. Smallest, highest-leverage change.
5. **ADK `after_model_callback`** in [api/agent/callbacks.py](../api/agent/callbacks.py) — captures every chat / autonomous / sub-agent LLM call in one shot. Plumb the callback into `LlmAgent` config in [api/agent/agent.py:199-209](../api/agent/agent.py#L199-L209).
6. **Direct `generate_content` call sites** — wrap each in a small helper that calls `cost_meter.log_cost(...)` after the API call. 10 sites; mechanical edit. Group by feature so the `feature` tag is correct.
7. **Provider wrappers** — instrument at [workers/collection/wrapper.py](../workers/collection/wrapper.py) so all 4 scraping providers funnel through one `log_cost` call. Apify uses provider-reported cost; others use `cost_rates.py`.
8. **Smoke test** — start a small collection on a test org, run a chat session; within 5 min the verification SQL in `PRODUCTION_PLAN.md` returns non-zero `cost_micros` per provider + per model.

Open question before coding: do we need `request_id` propagation in place first? Probably yes for any chat / agent calls — without it we can't pair an LLM cost row to the user-visible request. That's tied to §C.2 (structured logging + request IDs). Cleanest order: do `request_id` middleware first, then steps 1-8.

---

## Out of scope for this audit

- Lemon Squeezy webhook accounting → revenue, not cost. Already covered by `credit_purchase`.
- SendGrid email cost → trivial, ignore until volume warrants.
- Firebase Auth → free at our tier.
- Firestore reads/writes → effectively free at our scale; ignore until BQ aggregate suggests otherwise.
