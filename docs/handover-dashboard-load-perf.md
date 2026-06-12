# Handover — Dashboard slow load (round 2: download fixed, ~8s warm remains)

> Paste the "PROMPT FOR NEW CHAT" section below into a fresh Claude Code session.
> Everything above it is evidence already gathered + what's already been fixed.

---

## TL;DR of where we are

The dashboard *was* ~15s on **every** load. Round 1 of this investigation (a prior
session) **wrongly** concluded the `scope_posts` BigQuery TVF was the bottleneck. Round 2
(this session) **measured** it and disproved that:

| Phase (largest agent, 4,937 rows) | Time |
|---|---|
| TVF query execution (BQ job elapsed) | ~2.3–4.7s |
| **Row download to API server (REST `tabledata.list`)** | **~20s** ← real cost |
| Bytes processed (unchanged by any query rewrite) | 312 MB |

**Fix shipped this session** (uncommitted on branch `DashboardDesign`):
1. `workers/shared/bq_client.py` — `query()` now downloads via the **BigQuery Storage Read
   API** (Arrow stream) instead of REST row iteration, reusing one cached
   `BigQueryReadClient`, with a graceful REST fallback. Output is byte-identical (JSON
   columns re-parsed, datetimes isoformatted in `_normalize_rows`). Centralized → every BQ
   caller benefits (`/feed`, data tab, topics, briefings).
2. `api/main.py` — added `GZipMiddleware(minimum_size=1024)`. Payload 8.2MB → 2.28MB on the
   wire.
3. Tests: `workers/shared/test_bq_client.py` (6, passing). Bug doc:
   `docs/bugs/api-dashboard-slow-row-download.md`.
4. Reverted a prototyped `scope.sql` semi-join pushdown — proven byte-identical but **zero
   wall-clock win + slight slot regression**. The TVF is fine; leave it alone.

### Measured A/B at the real endpoint (`GET /dashboard/shares/public/{token}`, gzip on both)

| | Cold (run 1) | Warm (runs 2–3) |
|---|---|---|
| OLD (REST download) | 21.8s | ~15.3–15.9s |
| NEW (Storage API) | 16.5s | **~8.0–8.2s** |

So warm load is ~1.9× faster (15.3s → 8.0s). **But ~8s warm is still not good enough** —
that's what the next session must attack.

## Where the remaining ~8s (warm) likely goes — UNCONFIRMED, investigate

On a warm load the BQ *query* is cache-served (cheap), so ~8s is mostly API-server +
transfer work over an 8MB / ~2,780-post payload. Candidate bottlenecks, roughly ordered:

1. **Storage-API download itself (~6s in isolation on a dev laptop).** Includes
   cross-region RTT (laptop → `us-central1`). On Cloud Run in-region this should be much
   less — *measure on deployed env before optimizing further locally.*
2. **Per-row Python serialization.** `build_post_response()` runs for all ~2,780 rows
   (`api/services/dashboard_service.py`), calling `parse_json_field` / `_parse_custom_fields`
   / `_serialize_media_refs` (json.loads/json.dumps per row per field). Profile this — it
   may be a meaningful chunk and is pure CPU on the event loop's thread.
3. **gzip compression CPU.** Compressing 8MB per request costs CPU and is *added* latency
   on localhost (no transfer benefit there). Worth it for real users, but confirm it isn't
   dominating; consider a lower compresslevel if so.
4. **Payload size at the root.** ~2,780 posts each carrying full `content` + `ai_summary` +
   `context` (large text). The biggest structural win is likely **sending less**: trim
   columns the client doesn't need up-front, and/or paginate the data table while sending
   only aggregates + a first page. Check what `StatsTab.tsx` / `DashboardView.tsx` /
   `SharedDashboardPage.tsx` actually consume before trimming (don't break widgets).
5. **The 2nd/3rd parallel queries.** Authed path runs posts+kpis+topics; share path runs
   posts+topics. They're `asyncio.gather`'d (parallel) so they shouldn't add wall-clock,
   but confirm `topic_metrics` isn't the long pole on some agents.

## Also explicitly requested: add a short-TTL response cache

Data "doesn't change a lot" → a minutes-TTL cache is acceptable. Add it AFTER the further
bottleneck hunt (or alongside). Key by `(agent_id, sorted(collection_ids))`; cache the
assembled posts+topics+kpis payload. Both endpoints
(`api/routers/dashboard.py::get_dashboard_data`,
`api/routers/dashboard_shares.py::get_shared_dashboard`) should share it. In-process TTL
(e.g. `cachetools.TTLCache`) is simplest for a single Cloud Run instance; if multi-instance
correctness matters, back it with Firestore/Redis. Must invalidate (or just TTL-expire) so
a new agent run's data shows up within minutes. This makes warm/repeat loads near-instant
even if the per-request work above stays.

## Guardrails (unchanged, still hard requirements)

- `scope_posts` is the shared source of truth (`/feed`, data tab, topics, briefings,
  overview). **Do not change its semantics.** Round 2 already proved the query isn't the
  bottleneck — don't reopen that unless new evidence says so.
- Any change to `BQClient.query` is global — prove row-output equivalence before/after
  (we used `COUNT` + `BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(t)))`, and a SHA over all
  rows REST-vs-new).
- Prod service account needs `bigquery.readsessions.create` (in `roles/bigquery.user`) for
  the Storage API; absent → REST fallback (slow but correct). Confirm the deployed SA has
  it.

## Useful facts for the next session

- **Sample agent (largest, good stress test):** `4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f`
  (7,442 enriched / 4,937 scoped rows). Others: `f9022b29-…` (3,535).
- **Share token under test:** `zvZpnv4SLQSpuGdemEgujzoiaa-8ZagCWHR7WRKea4Y`.
- **BQ project / region:** `social-listening-pl` / `us-central1` (dataset
  `social_listening`).
- **Run the API locally** (from repo root, NOT `api/`, because of absolute `api.` imports):
  `PYTHONPATH=. .venv/Scripts/python.exe -m uvicorn api.main:app --port 8001`
  Endpoint (no `/api` prefix locally): `GET http://localhost:8001/dashboard/shares/public/{token}`.
- **Time it:** `curl -s --compressed -o /dev/null -w "%{time_total}s %{size_download}\n" -H "Accept-Encoding: gzip" <url>`
- **Real BQ job timing** (separate query exec from download): run with `--format=none`,
  grab the `bqjob_…` id, then
  `bq --location=us-central1 --format=prettyjson show -j <id>` → `statistics.endTime -
  startTime` (elapsed), `statistics.query.totalSlotMs`, `totalBytesProcessed`.
- **You MAY** query BigQuery (dry-run + bounded samples; the project owner authorized small
  reads) and **use the Playwright MCP** against the live dashboard to profile the front-end
  and capture network timings:
  **http://localhost:5174/shared/zvZpnv4SLQSpuGdemEgujzoiaa-8ZagCWHR7WRKea4Y**
  (frontend dev server on :5174; start it with `cd frontend && npm run dev` if down). Put
  any MCP screenshots in `.playwright-mcp/` and clean up after (see CLAUDE.md).

---

## PROMPT FOR NEW CHAT

I'm continuing dashboard load-time optimization in this monorepo (`frontend/` React+Vite,
`api/` FastAPI, `bigquery/`). Read `docs/handover-dashboard-load-perf.md` first — it has
the full measured history and the guardrails.

Status: a prior session proved the bottleneck was **result download**, not the
`scope_posts` TVF, and shipped (uncommitted on `DashboardDesign`): BigQuery Storage Read
API downloads in `workers/shared/bq_client.py`, and `GZipMiddleware` in `api/main.py`. That
took warm loads from ~15s → ~8s. **~8s is still too slow.**

Your job:
1. **Find the next bottleneck.** Profile a warm load of the public share endpoint end to
   end — BQ query vs Storage download vs per-row Python serialization
   (`build_post_response` in `api/services/dashboard_service.py`) vs gzip CPU vs payload
   size. Use the timing recipes in the handover. You MAY run BigQuery (dry-run + small
   samples) and the Playwright MCP against the live dashboard:
   http://localhost:5174/shared/zvZpnv4SLQSpuGdemEgujzoiaa-8ZagCWHR7WRKea4Y
   (check the Network panel timing + payload size; confirm `content-encoding: gzip`).
2. **Fix the biggest one**, behavior-preserving. Likely candidates: trim/paginate the
   ~2,780-post / 8MB payload (verify what the FE actually consumes first — `StatsTab.tsx`,
   `DashboardView.tsx`, `SharedDashboardPage.tsx` — don't break widgets), reduce per-row
   serialization cost, or measure on Cloud Run where cross-region RTT disappears.
3. **Add a short-TTL response cache** keyed by `(agent_id, sorted(collection_ids))` shared
   by both `api/routers/dashboard.py::get_dashboard_data` and
   `api/routers/dashboard_shares.py::get_shared_dashboard`, TTL of a few minutes, so
   warm/repeat loads are near-instant. Must let a new agent run's data appear within the
   TTL.

Hard rules: don't change `scope_posts` semantics (shared source of truth — see handover);
any `BQClient.query` change must be proven row-identical; `cd frontend && npx tsc --noEmit`
if you touch the FE; run backend tests; follow TDD + write a `docs/bugs/<area>-<slug>.md`
entry per CLAUDE.md. Measure before/after for every change — the prior round showed an
"obvious" optimization (TVF semi-join) that did nothing, so don't trust theory over numbers.
