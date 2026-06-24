# workers — duplicate alert emails (one per sub-collection)

## Symptom
One alert on agent `f9022b29` sent 3 emails in ~17 min (10:06/10:13/10:18 IDT),
each with a *different* set of posts. User expected 1 email for 1 run.

## Investigation (prod logs, 2026-06-24)
`evaluator INFO Alert evaluation for <id>` lines showed the 3 emails came from 3
**different collection_ids**, plus a 4th eval that sent 0:

| UTC | collection | posts | emails |
|---|---|---|---|
| 07:06 | 6075be87 | 512 | 1 |
| 07:13 | 1a5f0f6d | 377 | 1 |
| 07:18 | b6704eda | 712 | 1 |
| 07:23 | 0977b81c | 70 | 0 (all deduped) |

`agent_continuation` logs confirmed all 4 belong to the same agent, all started
~07:01 (`Starting collection worker ... continuation=False`).

## Root cause
An agent run fans out into **one collection per source/channel** (here 4). Alert
evaluation was hooked at **per-collection** completion
(`workers/pipeline/runner.py::_set_final_status` → `evaluate_alerts_for_collection`),
so each sub-collection fired its own email. The per-alert `alerted_posts` dedup
ledger trimmed overlap, which is why the 4th sent nothing and the first 3 had
disjoint posts — but it can't merge them into one email. NOT an enrichment-timing
or dedup bug; the trigger point was wrong.

## Fix
Move alert evaluation to **agent-run** completion. `agent_continuation.py::
check_agent_completion` already has an `all_complete` gate that fires exactly once
per run (when every collection in the active run reaches a terminal state).
- `workers/alerts/evaluator.py`: added `evaluate_alerts_for_agent_run(agent_id,
  collection_ids, ...)` that scans posts across ALL the run's collections in one
  pass; `evaluate_alerts_for_collection` kept as a thin single-collection wrapper
  (manual `/alerts/evaluate` re-runs). `_fetch_run_posts` now takes a list
  (`build_dashboard_sql` already accepted one).
- `workers/agent_continuation.py`: call `evaluate_alerts_for_agent_run` in the
  `all_complete` branch (last, guarded — can't strand the continuation).
- `workers/pipeline/runner.py::_set_final_status`: removed the per-collection call.

Result: one batched email per run regardless of collection count. (Residual: two
collections finalizing concurrently on different worker instances could both pass
the gate; the dedup ledger remains the backstop, as it was before.)

## Regression test
`api/tests/test_alerts.py::test_agent_run_with_many_collections_sends_one_email`
— a 4-collection run → exactly 1 email, all posts marked seen. 22 passed.

## Commit
Branch `dev` (uncommitted at time of writing).
