# Recurring agent schedules — why "hourly" appeared not to fire

## Symptom
Agent `f9022b29` ("2026 World Cup…") was set to hourly (`schedule.frequency = "1h"`)
but appeared never to auto-run — its runs were days apart and looked manual.

## Actual root cause (NOT the scheduler filter)
The schedule mechanism was working. Cloud Scheduler (`POST /internal/scheduler/tick`,
every 5 min) → `get_due_recurring_agents()` → `dispatch_agent_run`. A recurring
agent rests at status `success` after a normal run, and the eligibility gate
already allowed `success`/never-run.

What actually kept `f9022b29` from auto-running: the **watchdog falsely killed
it** (`signal=orphaned_running`) during long multimodal enrichment, stranding it
at status `failed` — which is correctly excluded from scheduling. So it never
*stayed* `success` at a due tick. That was fixed separately in **b167b60**
("stop watchdog killing healthy long-enrichment runs", 2026-06-16). Once that
deployed, the agent reached and held `success`, and the existing scheduler
dispatched it on the next due tick (observed: a `trigger=scheduled` run started
2026-06-21 08:55, under the pre-existing code).

## What this fix actually changes
1. **Hourly schedules align to the top of the hour.** Previously
   `compute_next_run_at("1h", t)` returned `t + 1h` (drifting by the set minute);
   now it truncates to the hour first, so a schedule set at 14:42 first runs at
   ~15:00. (`workers/pipeline/schedule_utils.py`.)
2. **Refactor only:** the eligibility check is extracted into a pure,
   unit-testable predicate `is_recurring_agent_due(agent, now)`;
   `get_due_recurring_agents` delegates to it. Semantics are unchanged from the
   prior `(None, "success")` allowlist (`SCHEDULABLE_STATUSES`).

### Rejected change (reverted)
An earlier version broadened the gate to a denylist (rescheduling `completed`
and `failed` agents too). Reverted: no current code path sets a recurring agent
to `completed`, so the only effect was resurrecting dormant legacy agents and
hourly-retrying genuinely-broken ones. Three stale April agents (`2087d32c`,
`68aafc12`, `ae775f20`) that this would have re-run were paused.

## Regression test
`workers/pipeline/test_schedule_utils.py` — covers the top-of-hour alignment and
the `success`/`None`-only eligibility (failed/completed/mid-run/archived/paused
all excluded).
