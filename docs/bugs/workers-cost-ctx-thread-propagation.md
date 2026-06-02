# Worker cost-meter ContextVar dropped across thread boundaries

## Symptom

Per-agent **Recent Activity** in the admin User Detail page showed only
chat-side priced events (autonomous / verify_briefing / Gemini) - every
worker-pipeline row (Apify scrape, X API search, BrightData posts_collected,
enrichment Gemini calls) was either:

- Bucketed under "Unassigned" (when only `agent_id` was missing), or
- Hidden entirely from the user's view (when `user_id` was also empty, so
  `WHERE user_id = @uid` excluded the row).

The user-level "by provider" cost breakdown still showed Apify $0.26 etc.
because some events DID make it through (e.g. provider_reported rows fired
from a thread that happened to still have ctx for unrelated reasons), but
the per-agent grouping was unreliable.

## Root cause

`api/services/cost_meter.py::set_collection_context` writes user_id /
org_id / collection_id / agent_id into a Python `ContextVar`. Per docs:

> Each thread has its own context object. Setting a value in one thread
> does not affect other threads.

`workers/server.py` binds the ContextVar in the **request-handler thread**
before calling `run_pipeline`. The pipeline then spawns:

1. `_crawl` thread (in `PipelineRunner.run()`)
2. Apify adapter's per-platform `threading.Thread` (in `ApifyAdapter.collect()`)
3. Apify's per-keyword `ThreadPoolExecutor.submit` calls (FB / TikTok)
4. Pipeline step worker threads (download / enrich)
5. Streaming runners (`StreamingStepRunner`)

None of these inherit the parent context, so every priced call inside a
child thread fired with empty `_collection_context` and `log_cost` was
unable to fill in `user_id` / `agent_id` from the fallback. Result:
attribution silently dropped.

## Fix

`api/services/cost_meter.py` gained two helpers:

- `start_thread_with_cost_context(target, args=, ...)` - drop-in for
  `threading.Thread(target=...)` that captures the parent context via
  `contextvars.copy_context()` and `Context.run()`s the target inside the
  snapshot in the child thread.
- `submit_with_cost_context(executor, target, ...)` - same idea for
  `ThreadPoolExecutor.submit`.

Applied at every spawn site that can lead to a `log_cost` /
`log_gemini_response` call:

- `workers/pipeline/runner.py`: `_crawl` thread + step worker threads +
  streaming runner threads
- `workers/collection/adapters/apify.py`: per-platform `_drive` threads +
  FB/TikTok keyword fan-out pools

Defensive belt-and-braces: `track_posts_collected` in
`runner.py::_do_crawl` now passes `agent_id` (from
`self._status_doc.get("agent_id")`) **explicitly**, so even if a future
thread-spawn site is added without the helper, per-agent attribution for
posts_collected events still works.

## Regression test

`api/tests/test_cost_meter.py::test_start_thread_with_cost_context_propagates_ctx`
pins the helper's behavior: binds the ContextVar in a parent block,
spawns a worker via the helper, fires `log_cost(user_id="")`, then
asserts the row has the parent's `user_id` / `agent_id` /
`collection_id`. Without the helper the row would have `user_id=""` and
`agent_id=None`.

## Related work in the same fix

While here we also wired:

- `platform` column on every `usage_events` row (Finance can now render a
  platform × provider matrix - Apify charges different per-call prices for
  IG vs FB vs TikTok).
- `cost_source` column distinguishing `provider_reported` /
  `rate_table` / `estimated_fallback` (Apify now logs an estimate when
  `run.usageTotalUsd` is silent, rather than skipping the row).

See `scripts/migrate_usage_events_add_platform_cost_source.py` (already
applied to prod BQ).
