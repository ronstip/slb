# Recurring agent stuck `failed`; scheduled runs silently skipped

**Symptom:** Recurring agent (`f530b4bc-979d-4474-95c2-43eb4f02dfb9`, "מעקב בחירות ישראל 2026")
did not run its 11:00 (GMT+3) scheduled job. No error surfaced; the run simply never
fired. `agent.status="failed"`, `next_run_at` frozen at the prior slot.

## Repro
1. Recurring agent with a multi-query continuation (briefing generation).
2. Runtime SA (`sl-api@`) lacks `bigquery.readsessions.create` (no `roles/bigquery.readSessionUser`).
3. Trigger a continuation (scheduled run or source-refresh) → it crawls through many BQ
   queries and exceeds the request deadline → `status=failed`.
4. Scheduler eligibility gate (`is_recurring_agent_due`, `workers/pipeline/schedule_utils.py`)
   only dispatches when `status in (success, None)` → all future runs skipped; `next_run_at`
   never advances.

## Root cause (two layers)
- **IAM:** `sl-api` SA has `bigquery.dataEditor/dataViewer/jobUser` but none grant
  `bigquery.readsessions.create`. Every BigQuery Storage Read API call 403s.
- **Code:** `BQClient._bqstorage_read_client` only cached `False` when the *client
  constructor* failed. The 403 fires later, at `create_read_session` inside `to_arrow`,
  so the client stayed "live" and **every** query paid a doomed Storage round-trip + slow
  REST re-download (`workers/shared/bq_client.py::_download_rows`). Across a continuation's
  many queries this compounded into a request-deadline timeout → continuation raised →
  `api/routers/internal.py:130` wrote `status=failed`.

Observed: continuation ran 12:13→12:26+ UTC on 2026-06-22, each query logging
`PermissionDenied: ... bigquery.readsessions.create` then "falling back to REST".

## Fix
- Code: on any Storage-path failure, set `self._bqstorage = False` so the rest of the
  instance's queries skip Storage entirely. Test:
  `workers/shared/test_bq_client.py::test_download_rows_disables_storage_after_failure`.
- IAM (true root cause): grant `roles/bigquery.readSessionUser` to `sl-api@` (and `sl-worker@`).
- Operational: reset the stuck agent `status→success` + advance `next_run_at` to unblock the schedule.

## Follow-up worth considering
A failed continuation should not brick a recurring agent's *schedule* indefinitely — consider
advancing `next_run_at` past failures, or letting the eligibility gate retry after a cooldown.

Fix commit: (pending — code on branch `dev`)
