# workers — BQ "Iterator has already started" 500s

**Sentry:** SCOLTO-BACKEND-M (escalating, 39+ events). Surfaced to users as frontend
"connection error" (`TypeError: Failed to fetch`, SCOLTO-FRONTEND-C / -9).

## Symptom
`GET /agents/{agent_id}/topics` → 500.
`ValueError: ('Iterator has already started', <RowIterator>)` at
`workers/shared/bq_client.py` `_download_rows`.

## Repro
Any `BQClient.query()` where the Storage Read API path is attempted and
`results.to_arrow(bqstorage_client=...)` raises (perms / Arrow stream / JSON
column). The REST fallback then re-iterated the same iterator.

## Root cause
Regression from commit `19580aa` ("dashboard performance improvements + cache"),
which added the Storage Read API download path. `to_arrow` **starts** the
`RowIterator` before failing; the `except` fallback ran
`[dict(r) for r in results]` on that already-started iterator, which
google's `page_iterator.__iter__` rejects. The failure is non-transient, so
`_retry` re-raised straight into the broken fallback.

## Fix
`_download_rows` now takes `query_job` and, on Storage failure, re-fetches a
**fresh** iterator via `self._client.list_rows(query_job.destination)` instead
of reusing the poisoned one. Caller updated to pass `query_job`.

- Regression test: `workers/shared/test_bq_client.py::test_download_rows_falls_back_to_fresh_iterator_after_arrow_failure`
- Fix commit: (uncommitted — branch `dev`)

## Still open
Why `to_arrow` fails at all in prod is unconfirmed (the
`"Storage API download failed"` warning is not shipped to Sentry logs). Likely
runtime SA lacks `bigquery.readsessions.create`, or Arrow conversion chokes on a
JSON column. Until that's resolved the Storage "perf" path silently degrades to
REST every call — the speedup from `19580aa` is effectively not active in prod.
