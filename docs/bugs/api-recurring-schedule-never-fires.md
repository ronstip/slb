# Recurring agent schedules never fire (hourly/daily auto-runs don't run)

## Symptom
Agent `f9022b29` ("2026 World Cup…") configured for an hourly schedule
(`schedule.frequency = "1h"`) never produced a scheduled run. All 8 of its
runs were `trigger="manual"`, days apart; an hourly agent alive since 2026-06-07
should have ~hundreds. Across the whole project, the Cloud Scheduler tick fired
every 5 min and returned 200 OK, yet **zero** recurring agents were dispatched
in 90 days — no "recurring agent(s) due" log ever emitted.

## Root cause
`FirestoreClient.get_due_recurring_agents()` gated eligibility with an
*allowlist*:

```python
if data.get("status") not in (None, "success"):
    continue
```

But recurring agents rest in a variety of terminal statuses — `"completed"`
as well as `"success"` — and get stranded in `"failed"` by transient errors
(see api-agent-false-orphaned-running.md). The allowlist silently excluded all
of those, so once an agent left the exact `"success"` state it was never
rescheduled. Live snapshot: 6 recurring agents were time-due; every one was
filtered out (paused, or status `completed`/`analyzing`/`failed`).

The scheduler tick itself (Cloud Scheduler → `POST /internal/scheduler/tick`
in prod, `OngoingScheduler` thread in dev) was healthy — it just kept getting
an empty due-list.

## Fix
Replaced the allowlist with a *denylist* predicate extracted as a pure,
unit-testable function `is_recurring_agent_due(agent, now)` in
`workers/pipeline/schedule_utils.py`. An agent is due when it is recurring,
not paused, not `archived`, not in any in-flight status (`ACTIVE_STATUSES`:
running/executing/analyzing/collecting/enriching/processing/building/queued/
in_progress), and `next_run_at <= now`. This allows `success`, `completed`,
`failed`, and never-run (`None`) agents to reschedule — a recurring monitor is
expected to keep trying on schedule, including a retry after a failed run.
`get_due_recurring_agents()` now delegates to this predicate.

After the fix, the live due-query returns the 3 previously-stranded agents
(2 `completed`, 1 `failed`); `dispatch_agent_run` recomputes `next_run_at` from
`now`, so they resume cadence without a burst.

## Regression test
`workers/pipeline/test_schedule_utils.py` — 13 cases incl.
`test_due_when_status_completed`, `test_due_when_status_failed_retries_next_cycle`,
`test_not_due_when_mid_run`, `test_not_due_when_archived/paused`.

## Fix commit
Branch `dev`, uncommitted at time of writing.
