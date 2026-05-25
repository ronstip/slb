# X-API cost rows never priced — provider-name mismatch hid them in admin

## Repro
- A user runs collections through the X (Twitter) adapter (and/or fetches
  per-post comments).
- Admin → UserDetail → "Cost breakdown by provider" shows only Brightdata
  even though the user clearly used X and Apify too.
- The user-reported symptom is "I'm only seeing Brightdata, but I'm 99% sure
  the user was using X and apify as well."

## Root cause
Two related gaps:

1. **Naming mismatch.** The X adapter stamps `Post.crawl_provider = "xapi"`
   (no underscore). The legacy cost path (`usage_service._log_event` via
   `track_posts_collected`) passes that value as `provider` to
   `config.cost_rates.compute_cost_micros(provider, ...)`. The rate-table
   key is `"x_api"` (with underscore). The lookup misses, `cost_micros` is
   left NULL, and the admin breakdown filter `WHERE cost_micros IS NOT
   NULL` (`api/routers/admin.py:296`) hides the row. Brightdata works
   because its `crawl_provider` already matches the rate-table key.

2. **Comments worker never priced.** `workers/comments/worker.py` calls X
   API but issues no `cost_meter.log_cost` — every reply-tree fetch costs
   money and was invisible to BigQuery + the wallet.

## Fix
- `config/cost_rates.py` — add `normalize_provider()` and a small alias map
  (`{"xapi": "x_api"}`); `compute_cost_micros` calls it before the rate
  lookup so every caller benefits.
- `api/services/cost_meter.py` + `api/services/usage_service.py` — normalize
  the `provider` value before the BQ row is written so historical "xapi"
  rows + new ones converge on the canonical "x_api" label in admin views.
- `api/services/usage_service.py::_log_event` — also write `agent_id`
  (added param + ContextVar fallback) so legacy event types (`scrape`)
  participate in the new per-agent admin rollup.
- `workers/comments/worker.py` — log one `cost_meter.log_cost(provider=
  "x_api", feature="comments", units=len(comments) + 1)` per run; +1
  accounts for the root-tweet lookup we issue to resolve the
  `conversation_id`.
- `api/routers/posts.py::fetch_post_comments_endpoint` — thread `user_id` +
  `org_id` into the task payload so cost attribution survives even in dev
  mode where `workers/server.py` context binding is bypassed.

Historical NULL-cost X rows stay NULL (no backfill); the table is mostly
empty there anyway. From the fix forward, X API + comments show up in
admin cost-by-provider for every user.

## Regression tests
- `api/tests/test_admin_finance.py::test_agent_cost_breakdown_unassigned_bucket`
  (exercises the COALESCE-NULL-to-"_unassigned" path used by the new
  per-agent admin rollup, which depends on `_log_event` writing
  `agent_id`).
- Existing `api/tests/test_cost_meter.py` (12 cases) still pass — the
  provider-normalize call sits before the row build and is a no-op for
  already-canonical names.

## Related — second & third silent bugs in the same area

While verifying the fix two more cost-attribution gaps surfaced:

1. **`cost_meter.log_cost` had no context fallback for `user_id`.**
   `workers/collection/adapters/apify.py` passed `user_id=""` thinking the
   bound `collection_context_scope` (from `workers/server.py`) would fill
   it — but only `log_gemini_response` actually read the context. Every
   priced Apify run since cost telemetry shipped landed with empty
   `user_id`, hidden from the per-user admin breakdown. Fixed by reading
   `user_id`/`org_id`/`collection_id`/`agent_id` from the ContextVar
   inside `log_cost` itself when callers don't pass them; pinned by
   `api/tests/test_cost_meter.py::test_log_cost_inherits_user_id_from_collection_context`.

2. **Apify cost-extraction key path was wrong.** `apify.py::_run_actor`
   looked for `run["usage"]["totalUsageUsd"]` — but the Apify API
   exposes the total USD at the **run top level** as `usageTotalUsd`.
   `run["usage"]` is the per-resource (compute units, dataset writes)
   dict; it has NO USD key. Result: Apify never reported a cost number,
   so `log_cost` was never even called and no Apify cost row was ever
   written to BigQuery. Fixed to try `run["usageTotalUsd"]` first, with
   the two legacy paths as fallback, and to log a WARNING when the run
   returns no cost at all so future API changes don't silently re-mute
   the spend.

## Recovery
- `scripts/backfill_usage_attribution.py` performs two idempotent BQ
  MERGE/UPDATE passes to recover historical rows that the bugs above
  hid: empty-user_id rows are attributed via `collections.user_id`,
  x_api NULL-cost rows are repriced from `units × $0.005`. Apify rows
  that were never written cannot be recovered.
- `--dry-run` reports counts only; re-run without the flag to apply.

## Related
- Memory: `project_entitlements_wallet.md`, `credit_gate_enforcement.md`.
- Plan file: `C:\Users\sahar\.claude\plans\hi-i-have-this-warm-hartmanis.md`.
