# Dashboard week/month time buckets fragment in non-UTC timezones

## Symptom
A KPI number-card trendline (and any line chart) bucketed by **week** showed far
more points than the date range warranted — e.g. ~30 days of data rendered **9–10
weekly points** instead of ~5. Only reproduced in non-UTC timezones (e.g. TLV,
UTC+3); UTC/CI looked correct, so it hid in tests.

## Root cause
`bucketDate('week')` in `frontend/src/features/studio/dashboard/dashboard-aggregations.ts`
computed the week's Monday using **local** date math (`getDay`/`getDate`/`setDate`)
but emitted it via **`toISOString()` (UTC)**, while keeping each post's original
**time-of-day**. So two posts in the same ISO week at different clock times
(e.g. 01:00 and 23:00) converted to two different "Monday" UTC dates → the week
split into 2 keys. Across ~5 weeks this ~doubled the point count.

The `month` bucket had the same class of bug (local `getFullYear`/`getMonth` on a
`new Date(dateStr)`), shifting `2026-05-31T23:30:00Z` into June in UTC+ zones.

The `day` bucket was already correct because it slices the UTC ISO string
(`dateStr.slice(0,10)`) — the fix makes week/month consistent with it.

## Fix
Compute week Monday in **UTC off the calendar day only** (`getUTCDay`/`setUTCDate`
on `${dateStr.slice(0,10)}T00:00:00Z`), and derive month from `dateStr.slice(0,7)`.
Timezone-stable, no time-of-day influence.

## Regression test
`frontend/src/features/studio/dashboard/bucket-date.test.ts` — exercises week and
month grouping; the 30-day-span case asserts ≤6 weekly buckets. Run under a
non-UTC TZ to catch the original bug: `TZ=Asia/Jerusalem npx vitest run .../bucket-date.test.ts`.

## Fix commit
Uncommitted on branch `dev` (working tree) as of 2026-06-08.

## Related
Surfaced while adding a configurable X-axis (datetime dim + time bucket) to the
KPI number-card trendline. Note the upstream data cap: `scope_posts` is
`LIMIT 5000` with **no ORDER BY** (`api/services/dashboard_service.py`), so beyond
5000 posts the trendline's date range is a non-deterministic sample.
