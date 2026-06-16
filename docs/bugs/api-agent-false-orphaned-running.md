# Agent falsely marked `failed` while enrichment still running (orphaned_running)

## Symptom
Agent `f9022b29` ("2026 World Cup Brand Landscape"), runs on 2026-06-14 and
2026-06-16, both ended `status=failed` even though enrichment was healthy and
all 4 collections eventually reached `success`. `context_summary`:
> Watchdog gave up after 3 attempts (signal=orphaned_running).

Run docs left at `status=running`, `completed_at=None` (watchdog only touches
the agent doc, never the run doc).

## Repro
1. Run an agent to success once (sets `continuation_ready_at`).
2. Re-run it. Run dispatch did NOT clear `continuation_ready_at`.
3. Enrichment of a large data_scope (~2700 posts, multimodal) takes >10 min.
   Enrichment progress writes to the `agents/{id}/logs` subcollection, which
   does NOT bump the parent agent doc's `updated_at`.
4. Watchdog `recover_stuck_agents` (stale_minutes=10) sees:
   status=running + truthy (stale) `continuation_ready_at` + idle `updated_at`
   → `classify_stuck` returns `orphaned_running`. Retries 3× → marks `failed`.

## Root cause
Two compounding bugs:
1. **Stale `continuation_ready_at` never cleared on a new run.** It carried
   over from the prior successful run (3 days old), so `classify_stuck` took
   the orphaned branch from the start of every subsequent run.
2. **Liveness signal not heartbeated.** `add_agent_log` writes a subcollection,
   so a healthy long enrichment looks idle after `stale_minutes`.

## Fix
- `api/services/agent_service.py` run dispatch: clear `continuation_ready`,
  `continuation_ready_at`, `continuation_attempts` when starting a run.
- `workers/shared/stuck_detector.py`: orphaned_running branch now returns None
  when `collection_statuses` are provided and not all terminal (still
  collecting/enriching → not orphaned). Defense against any future stale field.
- `workers/shared/firestore_client.py` `get_stuck_agents`: fetch collection
  statuses for all running agents (not just the missed-handoff path) so the
  guard above has data.

## Regression test
`workers/shared/test_stuck_detector.py::test_orphaned_running_still_enriching_skipped`
(plus `test_orphaned_running_all_terminal_caught` to keep genuine orphan
detection).

## Fix commit
Branch `dev` (uncommitted at time of writing).
