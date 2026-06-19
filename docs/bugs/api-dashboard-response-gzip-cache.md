# api — warm dashboard hit re-gzips the whole payload every request (P0b)

## Symptom
Even on a warm response-cache HIT (no BigQuery), each `/dashboard/data` and
`/dashboard/shares/public/{token}` request re-serialized + re-compressed the full
assembled payload before sending. On the 8.5K-post share `wc26brands` the gzip
step alone cost ~366ms (slim, 11.5MB) to ~1.9s (full, 25MB) of blocking CPU per
hit — wasteful on a public share link hit concurrently.

## Diagnosis (measured, not assumed — the handoff's attribution was wrong)
- The handoff blamed "orjson + gzip ~0.35s". Microbench + live: orjson encode of
  the 11.5MB slim payload is **32ms**; the cost is **gzip at Starlette's default
  `compresslevel=9`** (366ms slim / ~1.9s full). Level 6 is ~same ratio at ~40%
  less CPU.
- Separately, the warm **wall-clock** TTFB floor (~1.9s identity on this dev box)
  is dominated by **Firestore metadata round-trips** (share doc, agent
  collections, batched statuses) — confirmed by the share `post-details` endpoint
  (1KB body, no transform/no big gzip) also taking ~1.9s warm. That floor is
  dev→GCP network latency; in prod (Cloud Run colocated with Firestore) it is
  ~tens of ms. So gzip is the real prod warm-CPU cost; the byte cache removes it.

## Fix
- New `api/services/dashboard_response.py`: a TTL `_BytesCache` of the final
  gzip-compressed body + `gzipped_json_response(payload, key, accept_encoding)`.
  Gzip-capable clients get the cached compressed bytes (compressed once at level 6
  on a miss) returned with `Content-Encoding: gzip` set by us — Starlette 0.52
  forwards an already-encoded body verbatim, so `GZipMiddleware` does NOT
  double-compress. Identity clients get a fresh (uncached) orjson body.
- Both routers build the response dict, compute a key, and return via the helper.
- Global `GZipMiddleware(compresslevel=6)` (was the implicit 9) — helps the
  cold/miss path and every other JSON route at identical wire size.

### Cache key — the correctness subtlety the handoff missed
The handoff proposed keying on `(cache_key + report_config hash + slim)`. That is
correct for the authed path (`data_cache_key`) but **insufficient for shares**:
the share body also embeds `title`/`layout`/`filterBarFilters`/`orientation`/
`reportScope`/`filterBarHidden`/`reportConfig` from Firestore, which change
independently of the post-data freshness stamp. `share_cache_key` folds a hash of
that metadata in, so an owner layout/title edit busts the cache instead of
serving a stale layout.

## Tests
`api/tests/test_dashboard_response_cache.py` (11): serving (gzip round-trip,
identity fallback, empty Accept-Encoding), caching (warm hit serves cached bytes
verbatim, no recompute; identity not cached), key correctness (data key reacts to
every input incl. collection-order independence; **share key busts on metadata
change, not just stamp**), and a `GZipMiddleware` integration test proving no
double-compression on the installed Starlette.

## Measured (live, warm, share `wc26brands`)
gzip warm CPU removed on cache hits: slim 0.74s→0.14s, full 1.87s→0.05s (gzip-HIT
TTFB collapses to the identity/Firestore floor). gzip body decodes byte-identical
to the identity body.

## Remaining
The ~1.9s dev warm-TTFB floor is Firestore metadata reads (largely dev-network;
small in prod). If prod RTT proves material, parallelize / short-TTL-cache the
share metadata reads — separate from P0b. The durable O(N)-payload fix is **P2**
(server-side aggregation) — see `docs/handoff-dashboard-payload-scalability.md`.

## Branch
`WidgetsAndBugFix` (uncommitted at time of writing).
