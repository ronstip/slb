# Recurring agent permanently de-scheduled by a single failed run

## Symptom

Two recurring agents silently stopped running on schedule:

- `f530b4bc` ("מעקב בחירות ישראל 2026", twice-daily) — 1 of 4 collections failed
  when the Apify account ran out of money → run `failed` → agent stuck.
- `f9022b29` ("2026 World Cup Brand Landscape", daily) — all collections
  succeeded, but the **analysis phase** ended without publishing a briefing
  (`compose briefing - layout failed validation`) → agent stuck.

Funding Apify did **not** bring either agent back: neither was ever going to
re-schedule itself.

## Root cause

A recurring agent's *schedulability* was gated on its *last run's outcome*.
`is_recurring_agent_due` only allowed `status in {None, "success"}`
(`SCHEDULABLE_STATUSES`). Any failed run flips the agent to `status="failed"`
— from three sites in `workers/agent_continuation.py`:

- `:169` continuation crashed
- `:452` run ended without `compose_briefing` (f9022b29's case)
- `:794` watchdog gave up after 3 retries

and a `failed` agent was excluded from scheduling forever. The exclusion was
deliberate (`docs/bugs/api-recurring-schedule-never-fires.md`) to avoid
*hourly-retrying* a genuinely-broken agent — but that fear predated
`next_run_at` being advanced at dispatch.

## Fix

Decouple schedulability from the last run's outcome; let `next_run_at` enforce
cadence:

1. `workers/pipeline/schedule_utils.py` — add `"failed"` to
   `SCHEDULABLE_STATUSES`. A failed recurring agent self-heals at its next slot.
   `status="failed"` is preserved (UI/history still shows the failure — we don't
   fake green). `"running"`/`"archived"`/legacy `"completed"` stay excluded.
2. `api/services/agent_service.py` (`dispatch_agent_run`) — advance `next_run_at`
   **up front**, before any guard (no sources / no runnable sources / credit
   refusal) or downstream failure, instead of only on the happy path. This is
   the safeguard that prevents the original 5-min-tight-loop: a failed/empty run
   now waits a full cadence slot before retrying, so a genuinely-broken agent
   retries once per slot (daily / twice-daily), never every scheduler tick.

## Tests

- `workers/pipeline/test_schedule_utils.py::test_due_when_status_failed_recurring_self_heals`
- `workers/pipeline/test_schedule_utils.py::test_not_due_when_failed_but_next_run_in_future`
- `api/tests/test_agent_schedule_advance.py::test_recurring_no_runnable_sources_still_advances_next_run`

## Recovery (one-off, already applied to prod 2026-06-26)

Both agents flipped `failed → success` with `next_run_at` set to their next
slot (`f530b4bc` → 06-26 18:00, `f9022b29` → 06-27 07:00). After this fix,
such manual recovery is no longer needed — failed recurring agents resume on
their own.

## Fix commit

dev branch, 2026-06-26 (see git log for SHA).
