# Finance "Absorbed cost (us + demos)" KPI showed "$NaN"

## Symptom

Admin → Finance, the "Absorbed cost (us + demos)" card rendered **$NaN** even
though a real admin test run had produced cost data (the other KPI cards were
fine).

## Root cause

`absorbed_cost_micros` (plus `paid_billed_micros` and `by_cost_source`) are
**new** fields added to `_finance_breakdown` in `api/routers/admin.py` in the
same uncommitted batch as the new KPI cards — they do NOT exist in the committed
(deployed) backend (`git show HEAD:api/routers/admin.py` → 0 hits). The card the
user saw was served by a FE build paired with a backend that predates the field,
so `fin.absorbed_cost_micros` was `undefined`. `formatUsdMicros(undefined)`
computed `undefined / 1e6` → `NaN` → `"$NaN"`.

It was never a data problem — the test-run cost was recorded correctly; only the
new field was missing because of FE/BE deploy skew.

## Fix

- Deploy the updated backend (ships `absorbed_cost_micros` / `paid_billed_micros`
  / `by_cost_source`).
- Defensive hardening so deploy skew can never render `$NaN` again:
  `formatUsdMicros` / `formatUsdCents`
  ([money.ts](../../frontend/src/lib/money.ts)) now coerce non-finite input
  (undefined/null/NaN) to `0` → renders `$0.00` / `$0`.

## Regression tests

- `frontend/src/lib/money.test.ts` — `formatUsdMicros`/`formatUsdCents` render
  `$0.00`/`$0` for undefined/NaN/null instead of `$NaN`.

## Fix commit

Branch `dev` (uncommitted at time of writing). Update with SHA on commit.
