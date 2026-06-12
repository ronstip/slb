# Dashboard warm load ~8s — no response cache + slow JSON encode

## Symptom
After round 2 (Storage Read API download + gzip) the dashboard still took ~8s on
warm/repeat loads, on both the authed studio view (`POST /dashboard/data`) and
the public share (`GET /dashboard/shares/public/{token}`). The share is a viral
surface hit many times with identical data; the authed view is reloaded often.

## Investigation (measured this round, not assumed)
Added per-request timing logs. On the share endpoint (token `zvZpnv4…`, agent
`f9022b29…`, 2,780 posts), through the real endpoint with gzip:

| Phase | Cold (cache MISS) | Warm (cache HIT) |
|---|---|---|
| Total wall-clock (curl) | 12.1s | **1.7s** |
| `gather_ms` (4 parallel BQ queries, incl. ~8MB posts download) | 6132 | 0 |
| `serialize_ms` (build 2,780 `DashboardPostResponse` + topics/kpis) | **33** | 0 |

Key correction to the prior handover: **per-row serialization was never the
bottleneck** (33ms for 2,780 rows). The cold cost is the BigQuery
download (`gather_ms`, dominated by cross-region RTT laptop→`us-central1` that
mostly disappears on in-region Cloud Run). The remaining ~1.7s warm is gzip
compression of the 8MB body + Firestore reads (share/title/layout/statuses) +
transfer — *not* Python serialization.

The real structural miss was that **both endpoints recomputed the identical
`(agent_id, collection_ids)` payload on every load with no cache.**

## Root cause
No response cache. Every load re-ran the posts/topics/kpis BigQuery queries and
re-serialized ~2,780 rows, even though the data only changes when an agent run
adds/refreshes posts (often static for hours/days).

## Fix
1. **Passive-invalidation response cache** (`api/services/dashboard_cache.py`):
   `cachetools.TTLCache` (1h safety-net TTL) keyed by
   `(agent_id, sorted(collection_ids), freshness_stamp)`. The stamp is the max
   `collection_status.updated_at` across the dashboard's collections — the
   pipeline bumps that field only when post-state counts change
   (`workers/pipeline/runner.py::_heartbeat_worker`). So **changed data busts the
   key instantly; static data serves from cache** without any BigQuery, and it's
   correct across Cloud Run instances (stamp read from Firestore, no worker hook
   needed). The authed path already reads `collection_status` for its access
   check → stamp is free there; the share path reads them itself (cheap vs ~6s
   BQ). Shared singleton across both endpoints; cached core is a jsonable dict
   (`assemble_dashboard_core` in `dashboard_service.py`) including
   posts/topics/kpis/collection_names so a hit touches zero BQ.
2. **App-wide orjson** (`main.py` `default_response_class=ORJSONResponse`) +
   returning the assembled dict via `ORJSONResponse` on the two heavy routes,
   skipping a second per-row Pydantic validation pass. Faster encode on every
   JSON route.
3. **Timing instrumentation** via `uvicorn.error` logger (prod runs bare
   `uvicorn`, which drops app `logger.info`; uvicorn's error logger has a handler
   in every env) → cache HIT/MISS + `gather_ms`/`serialize_ms` are visible in
   Cloud Run logs to measure the real in-region breakdown.

Result locally: warm share load **8s → ~1.7s** (cache HIT); payload byte-identical
between MISS and HIT and schema-valid against `SharedDashboardDataResponse`.

## Freshness semantics / known limits
- New posts / enrichment progress → `updated_at` bumps → instant cache miss.
- An **engagement-only refresh** (likes/comments on existing posts, no post-state
  count change) may not bump `updated_at`; the 1h TTL safety net bounds that
  staleness. Acceptable per product (data "doesn't change a lot").
- TTL is a memory bound, *not* the freshness mechanism — don't shorten it
  expecting fresher data; the stamp drives freshness.

## Regression tests
`api/services/test_dashboard_cache.py` — key normalization (collection order,
agent isolation), set/get roundtrip, **stamp-change → miss** (passive
invalidation), TTL expiry (injected timer, no sleep), freshness-stamp derivation
(max ISO, None/missing handling, datetime-like), thread-safety smoke. Existing
`workers/shared/test_bq_client.py` stays green.

## Deploy notes
- New deps: `cachetools`, `orjson` (added to `pyproject.toml`; run `uv sync` /
  `uv lock` on a machine with `uv` — installed here via venv pip as uv wasn't on
  PATH).
- No schema/TVF change. `scope_posts` semantics untouched. `BQClient.query`
  untouched.
- **Next:** read the new `dashboard.share` / `dashboard.data` timing lines on
  Cloud Run to confirm the in-region cold breakdown and that hits dominate; if
  warm hits are still gzip-bound, consider caching the gzipped bytes or lowering
  `GZipMiddleware` compresslevel.

Branch: `DashboardDesign` (uncommitted at time of writing).
