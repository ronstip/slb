# Dashboard ~15s load — slow BigQuery row download (not the TVF)

## Symptom
The dashboard (authed studio view + public share view) took ~15s on every load —
repeats just as slow as first load. 8.2MB JSON, ~2,780 posts (4,937 rows pre-filter
for the largest agent).

## Repro
- Authed: `POST /api/dashboard/data` with an agent's collection_ids.
- Public: `GET /api/dashboard/shares/public/{token}`.
- Both call `social_listening.scope_posts(@agent_id)` via `BQClient.query`.

## Investigation (measured, not assumed)
A prior handover (`docs/handover-dashboard-load-perf.md`) attributed the 15s to the
`scope_posts` TVF and proposed query/semi-join optimizations. **Benchmarking disproved
that.** On the largest agent (`4a809b8d…`, 7,442 enriched / 4,937 scoped rows):

| Phase | Time |
|---|---|
| TVF query execution (BQ job elapsed) | **~2.3–4.7s** (107k slot-ms) |
| Row download to the API server (`for row in results` REST `tabledata.list`) | **~20s** |
| Bytes processed | 312 MB (unchanged by any semi-join) |

So the dominant cost is **result download over the REST row API**, not query compute.
A semi-join pushdown into the TVF was prototyped and measured: output was byte-identical
(verified by `COUNT` + `BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(t)))`) but it gave **no
wall-clock win and a slight slot regression** (137k vs 107k slot-ms) — reverted.

## Root cause
`BQClient.query` downloaded rows with plain REST iteration (`for row in results`), which
pages via `tabledata.list` — slow for large/wide result sets. `google-cloud-bigquery-storage`
(the fast Arrow-stream Storage Read API) was already installed (pulled by `google-adk`) but
unused.

## Fix
`workers/shared/bq_client.py`:
- Download via the **BigQuery Storage Read API** (`results.to_arrow(bqstorage_client=…)
  .to_pylist()`), reusing one cached `BigQueryReadClient` across queries.
- Normalize the Arrow output back to the REST contract in `_normalize_rows`: JSON-typed
  columns (`media_refs`, `platform_metadata`, `custom_fields`, `comments`,
  `platform_engagements`) arrive as raw strings over Storage vs parsed dict/list over REST,
  so they're `json.loads`-ed; datetimes are isoformatted (as before).
- **Graceful REST fallback**: if the Storage client can't be created (e.g. the service
  account lacks `bigquery.readsessions.create`) or the Arrow download fails, fall back to
  REST iteration — no breakage, just no speedup.

This is centralized in `BQClient.query`, so **every** caller benefits (dashboard, `/feed`,
data tab, topics, briefings), not just the dashboard.

`api/main.py`:
- Added `GZipMiddleware(minimum_size=1024)` — the ~8MB post JSON was sent uncompressed;
  gzip cuts the over-the-wire transfer several-fold.

## Results (largest agent, cache-busted, through `BQClient.query`)
- REST download path: **24.8s**
- Storage API path: **11.2s** (~2.2×; ~14s saved). Lower in prod (Cloud Run is in-region
  with BQ; these numbers include cross-region RTT from a dev laptop).
- Row output proven byte-identical (SHA-256 over all 4,937 rows) between REST and Storage
  paths before changing the shared client.

## Regression tests
`workers/shared/test_bq_client.py` — `_normalize_rows`: parses JSON-string columns, leaves
already-parsed JSON untouched, isoformats datetimes/dates, never JSON-parses non-JSON
strings, leaves malformed JSON as raw string, preserves `None`.

## Deploy notes
- No schema/TVF change. No new declared dependency (storage lib already in `uv.lock` via
  `google-adk`).
- Ensure the API/worker service account can create read sessions
  (`bigquery.readsessions.create`, included in `roles/bigquery.user`). If absent, the code
  still works via REST fallback (slow, but correct).

## Follow-ups (not done here)
- Short-TTL response cache keyed by `(agent_id, sorted collection_ids)` for warm repeats.
- Trim/paginate the post payload if download is still a concern after Storage + gzip.

Fix branch: `DashboardDesign` (uncommitted at time of writing).
