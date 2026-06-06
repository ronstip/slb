# Enrichment / clustering cost logged with NULL user_id + agent_id

## Symptom

Admin → Users → user detail showed cost far below reality (test user
$7.59 / 166 events vs ~$30+ expected). The expensive **enrichment** step
appeared to contribute $0 per user/agent. Verified in BigQuery
(`social_listening.usage_events`, since 2026-05-01):

- `feature="enrich"`: **3,072 rows, $31.54, 100% NULL `user_id` AND `agent_id`**
  (and NULL `collection_id`/`session_id`/`request_id`).
- Same pattern: `topic_cluster` $1.22 (376 rows), some Apify `comments`, `wizard`.
- Total orphaned ≈ **$32.8** — the bulk of the "missing" cost.

The cost was computed correctly; it was just unattributed, so every
per-user / per-agent admin query (`WHERE user_id=@uid`) excluded it, and the
wallet was never debited.

## Root cause

`cost_meter` attributes cost via a `ContextVar` (`_collection_context`) bound
at the worker entry (`workers/server.py` for prod, `collection_service.py` for
dev). **ContextVars do not cross thread boundaries.**

The pipeline already wrapped the *runner-thread* spawns with
`start_thread_with_cost_context` ([runner.py](../../workers/pipeline/runner.py)),
but enrichment work runs in a **nested `ThreadPoolExecutor` inside
`StreamingStepRunner`**, submitted via a bare
`self._executor.submit(self._wrapped_process, post)`
([streaming.py:144](../../workers/pipeline/streaming.py#L144)). Those pool
workers start with an empty context, so `log_gemini_response` read an empty
collection context → `user_id=""`, `agent_id=None`. Same bug in the topic
clustering pools ([taxonomy.py:250,592](../../workers/topics/taxonomy.py#L250))
and the `enrich_posts` batch pool ([enricher.py:645](../../workers/enrichment/enricher.py#L645)).

The earlier fix (`docs/bugs/workers-cost-ctx-thread-propagation.md`) listed
`StreamingStepRunner` as a site to fix but only wrapped the runner-thread
spawn, not the runner's *internal* pool — so the leak persisted.

## Fix

- New `cost_meter.ContextAwareThreadPoolExecutor` — a `ThreadPoolExecutor`
  whose `submit()` snapshots the calling thread's contextvars and re-runs the
  task inside that snapshot. Makes propagation structural so new pools can't
  silently drop attribution.
- Swapped the leaking pools to it: `workers/pipeline/streaming.py`,
  `workers/topics/taxonomy.py` (both passes), `workers/enrichment/enricher.py`.
- `labeler.py` runs inline (no pool) — already fine.

Historical orphaned rows have no `collection_id` → cannot be reattributed;
left in place. A new **"Unattributed cost"** KPI on the Admin Finance page
(`FinanceSection.tsx`, derived from the existing `by_tier` "unattributed"
bucket) surfaces any future leak immediately instead of hiding it.

### Related consolidation (same change)

Cost had two writers: `cost_meter.log_cost` (Apify provider-reported, all
Gemini) and `usage_service.track_posts_collected` (which also priced
X-API/BrightData scrapes). Consolidated onto `cost_meter` as the single cost
source: the runner bucket loop now emits a `provider_call` cost row for
non-Apify scrapers ([runner.py](../../workers/pipeline/runner.py)), and
`usage_service._log_event` is now analytics-only (cost-free `posts_collected`
rows).

### Follow-up: dev-only `agent_id` binding gap (found during E2E verify)

The pool-propagation fix above correctly carries *whatever context is bound*.
But the **dev** entry bound an incomplete context: `collection_service.py`
derives the cost-context `agent_id` from `extra_config["agent_id"]`, and
`agent_service._build_base_extra_config` never puts `agent_id` there. So a dev
**agent** run bound `agent_id=None`, and every enrich/topic_cluster Gemini row
(which reads `agent_id` from the bound context) would have landed with
`agent_id=NULL` again — even with the pool fix. Prod was unaffected
(`workers/server.py` binds `agent_id` from the Firestore status doc).

Fix: `PipelineRunner._bind_cost_context` ([runner.py](../../workers/pipeline/runner.py))
rebinds the cost-meter context with the `agent_id` the runner already resolves
from Firestore, called once after lock acquisition + config load (so the
dispatch-time `agent_id` write has landed) and **before** any thread/pool spawn.
Single chokepoint → fixes dev and hardens prod regardless of caller. Token reset
in `run()`'s `finally`.

## Regression tests

- `api/tests/test_cost_meter.py::test_context_aware_pool_propagates_ctx`
- `api/tests/test_cost_meter.py::test_streaming_runner_pool_propagates_ctx`
  (reproduced the `user_id=''` orphan before the fix)
- `api/tests/test_usage_cost_consolidation.py` — pins volume-path cost-free +
  scrape cost via cost_meter (no double-count); `…::test_runner_rebinds_cost_context_with_resolved_agent_id`
  pins the dev-binding rebind.

## End-to-end verification (2026-06-05, dev, real providers)

Ran a 6-platform Nike agent (agent `aa5673cb…`, 6 collections, ~100 posts,
enrichment ON). Read-only BQ over the 6 `collection_id`s:

- **0** `priced event has NO user_id` WARN across all 6 run logs (the pre-fix
  log fired it repeatedly for `topic_cluster`).
- **136+ priced rows, `priced_orphaned=0`, `priced_no_agent=0`** — every priced
  row attributed to the run's `user_id` + `agent_id`. `enrich` (all 6 platforms)
  and `topic_cluster` now carry both.
- No double-count: scrape cost only on `provider_call`; `posts_collected` rows
  cost-free. Each (provider, platform) priced once.
- Hand-check vs `config/cost_rates.py` exact: e.g. YouTube enrich
  585694 in-tok × $0.50/Mtok + 1373 out-tok × $3.00/Mtok = 296966 micros =
  stored `cost_micros`. Scrape: x_api twitter 18 × $0.005 = $0.09; brightdata
  20 × $0.0025 = $0.05; apify provider-reported / estimated_fallback as expected.
  YouTube video cost is inside the enrich Gemini tokens (no separate row).
- Admin Finance "Unattributed cost" KPI = **$0.00** for the window.

## Fix commit

Branch `dev` (uncommitted at time of writing). Update with SHA on commit.

## Note (out of scope, pre-existing)

`test_cost_rates.py::test_x_api_owned_read_uses_cheaper_rate` fails
independently of this change: the admin-set scraper-rate matrix wildcard for
`x_api` ($0.005) shadows the per-endpoint `owned_read` rate ($0.001) in
`compute_cost_micros`. Pre-existing pricing-precedence question; not addressed
here.
