# Collection Performance Diagnostic

_Last updated: 2026-03-17 (run 2 analysis)_

## Confirmed Bugs

### BUG-1: BrightData premature "ready" status (FIXED ✓)

**Symptom:** Collection returns "No posts collected" despite BrightData showing snapshot as `ready`.

**Root cause:** BrightData's progress endpoint reports `status: "ready"` before the snapshot data
is actually available. Downloading the snapshot at that point returns a single error object:
```json
{"status": "building", "message": "Dataset is not ready yet, try again in 30s"}
```
This gets filtered by `_is_error_item()` → 0 valid posts → collection fails.

**Evidence from logs (2026-03-17 23:19:58):**
```
BD snapshot sd_mmv42w1z1bjo7by9e4: ready (205s)
Downloaded snapshot sd_mmv42w1z1bjo7by9e4: 1 records
BrightData error item: {'status': 'building', 'message': 'Dataset is not ready yet, try again in 30s'}
[reddit] collected 0 posts
```

**Fix applied:** `workers/collection/adapters/brightdata_client.py` — `download_snapshot()` now
detects the "building" response and retries up to 6 times with 30s wait between attempts
(matching BrightData's own suggestion). Total retry budget: +3 minutes.

---

## Performance Bottlenecks (To Be Resolved)

### PERF-1: `max_posts_per_keyword` math dilutes per-input limit

**File:** `api/services/collection_service.py:110-112`, `api/agent/tools/design_research.py:94-95`

**Problem:**
```python
max_posts_per_keyword = ceil(n_posts / (platforms × keywords))
```
This divides the budget evenly across all platforms × keywords. With moderate complexity
(2 platforms, 3 keywords, 500 posts target): `ceil(500 / 6) = 84` posts/input. BrightData
likely won't surface more than requested per keyword. Combined with deduplication, the ceiling
lands well under the target.

**Compounding factor (TikTok):** Hashtag variants are added as extra inputs (doubling inputs)
but the per-input limit stays the same, so TikTok's actual limit should be:
`ceil(n_posts / (1 × keywords × 2))` not `ceil(n_posts / (1 × keywords))`.

**Impact:** Hard ceiling of ~400-500 posts regardless of `n_posts` request.

**Fix options:**
- Option A: Increase `max_posts_per_keyword` multiplier (e.g. ×2 buffer) to account for deduplication loss.
- Option B: Don't divide by platform count — let each platform collect `ceil(n_posts / keywords)` and rely on dedup.
- Option C: For TikTok, compute `ceil(n_posts / (keywords + hashtags))` instead of `ceil(n_posts / keywords)`.

---

### PERF-2: `num_of_posts` in request body vs `limit_per_input` query parameter

**File:** `workers/collection/adapters/brightdata.py` (all three platform collectors),
         `workers/collection/adapters/brightdata_client.py:scrape_and_wait()`

**Problem:** There are two mechanisms to limit results per input:
1. **`limit_per_input`** — URL query parameter on `/datasets/v3/scrape` (official BrightData param)
2. **`num_of_posts`** — field inside each input dict in the request body

All platform collectors use `num_of_posts` in the body. The `limit_per_input` query param
in `scrape_and_wait()` is never used (always `None`). It's unclear from the code alone which
one BrightData actually respects for keyword discovery — their behavior may differ per dataset.

**Evidence:** Log showed `limit=None` on the trigger call, confirming the query param is not set.

**Fix options:**
- Test whether `limit_per_input` query param gives different (higher) results than `num_of_posts` body field.
- Pass `limit_per_input=num_per_kw` in addition to `num_of_posts` to cover both paths.

---

### PERF-3: BrightData snapshot poll timeout too short (FIXED ✓)

**Evidence from run 3 logs (2026-03-18 00:15):**
```
2 keywords ("Elon Musk", "Musk"), date_filter=Past year
Snapshot still "running" at 280s → hard timeout at 300s → 0 posts, failed
```
Run 2 (single keyword, Past month) barely made it at 300s. Any request slightly larger fails.

**Root cause:** The `brightdata_poll_max_wait_sec` default of 300s is too tight.
BrightData's processing time scales with query complexity (keywords × time range × platform).
Single keyword / Past month: ~200-300s. Two keywords / Past year: >300s.

**Fix applied:** Default raised from 300s → 600s in `config/settings.py`.
Override in `.env` with `BRIGHTDATA_POLL_MAX_WAIT_SEC=600` if needed.

**Note:** The 62s trigger latency is inherent BrightData infrastructure overhead — nothing we can do.

---

### PERF-4: Media download blocks batch enrichment (FIXED ✓)

**File:** `workers/collection/worker.py`

**Problem (confirmed by run 2 logs):** All 5 batches existed from the moment BrightData
returned (23:43:55), but processed sequentially with media blocking each one:
```
Batch 1: BQ=6.3s  media=13.8s  total=20.2s
Batch 2: BQ=4.6s  media=74.9s  total=79.5s   ← 75s waiting on Reddit CDN
Batch 3: BQ=4.1s  media=22.5s  total=26.6s
Batch 4: BQ=3.6s  media=58.9s  total=62.5s   ← 59s waiting on Reddit CDN
Batch 5: BQ=3.4s  media=18.7s  total=22.1s
Total: 211s  →  Could be ~20s for the main loop, ~75s wall time in parallel
```

**Fix applied (v2 — correct architecture):**
```
BrightData returns 238 posts
      ↓
BQ insert all 5 batches (fast, ~4s each) — feed shows posts with CDN URLs immediately
      ↓ (5 background threads, all start at the same time)
  Thread 1: download GCS → enrich batch 1 → update BQ media_refs (best-effort)
  Thread 2: download GCS → enrich batch 2 → update BQ media_refs (best-effort)
  Thread 3: download GCS → enrich batch 3 → update BQ media_refs (best-effort)
  Thread 4: download GCS → enrich batch 4 → update BQ media_refs (best-effort)
  Thread 5: download GCS → enrich batch 5 → update BQ media_refs (best-effort)
      ↓
run_collection() joins all threads (waits for all enrichment callbacks to be submitted)
      ↓
pipeline.py shuts down enrichment executor (waits for all Gemini calls to complete)
```

Key properties:
- **Enrichment always gets GCS URIs** — the background thread downloads first, then calls the enrichment callback
- **All batches process in parallel** — downloads and enrichment for all 5 batches run concurrently
- **Concurrency bounded by semaphore** — `enrichment_global_concurrency=50` prevents Gemini overload
- **BQ media_refs UPDATE** — one attempt per batch after downloads (by then streaming buffer may have cleared). No sleep, no retry. If it fails, CDN URLs remain in BQ (fine for display)

**Expected timing (wall clock):**
- Main loop (BQ inserts): ~4s × 5 batches = ~20s sequential
- Background threads (parallel): ~75s wall time (slowest batch, all run concurrently)
- pipeline.py waits for threads: `join()` adds ~75s to total — but this replaces what was 211s before
- Net improvement: 211s → ~95s for the batch processing phase (before enrichment wait)

---

### PERF-5: Per-batch BQ dedup query (N×1 roundtrip)

**File:** `workers/collection/worker.py:145-150`

**Problem:** For each batch of 50 posts, a separate synchronous BQ query checks for existing
post IDs. BQ has ~2-5s query startup latency, so 10 batches = 20-50s of pure overhead.

**Fix option:** Batch all post IDs from the entire collection result into a single pre-flight
dedup query before the batch loop. This is only safe for single-run collections; ongoing
collections need per-batch checks since new posts arrive incrementally.

---

### PERF-6: `brightdata_poll_initial_interval_sec` default mismatch

**File:** `config/settings.py:44` vs `workers/collection/adapters/brightdata_client.py:83`

**Problem:**
- `settings.py` default: `1.5`
- `BrightDataClient.__init__` signature default: `5.0`

If `BRIGHTDATA_POLL_INITIAL_INTERVAL_SEC` is not set in `.env`, the settings object returns
`1.5` and that IS passed to the client constructor — so `1.5` wins. The constructor default
of `5.0` is a dead fallback. Minor inconsistency but worth cleaning up.

---

## Timing Summaries

### Run 1 (2026-03-17, collection_id: 5d33cb18) — Failed (BUG-1)

| Phase | Duration |
|---|---|
| BrightData trigger | 62s |
| BrightData polling | 205s |
| Snapshot download | 3s — returned "building" error |
| **Result** | **FAILED — 0 posts (BUG-1)** |

### Run 2 (2026-03-17, collection_id: 358b0976) — 238/500 posts, ~10 min

| Phase | Duration | Notes |
|---|---|---|
| BrightData trigger | **62s** | BD infrastructure latency |
| BrightData polling (running → ready) | **300s** | 5 full minutes |
| Snapshot download | 6s | 238 records |
| Batch 1 (50 posts) | 20s | BQ=6s, media=14s (blocking) |
| Batch 2 (50 posts) | 79s | BQ=4s, media=**75s** (blocking) |
| Batch 3 (50 posts) | 27s | BQ=4s, media=23s (blocking) |
| Batch 4 (50 posts) | 63s | BQ=4s, media=**59s** (blocking) |
| Batch 5 (38 posts) | 22s | BQ=3s, media=19s (blocking) |
| **Total collection** | **597s (~10 min)** | |
| Enrichment (parallel) | 55s wait | Already running during collection |

**Why 238 and not 500?**
BrightData returned exactly 238 results for Reddit "Tesla" / Past month with `num_of_posts=500`
in the request body. The `limit_per_input` query param was `None` (not set). BrightData either
capped at their default, or there were genuinely only ~238 results for this query.

**Why 38 in the last batch?**
Normal: 238 posts ÷ 50-per-batch = 4 full batches + 38 remainder. Not a bug.

**Why 10 minutes to first batch?**
BrightData: 62s + 300s + 6s = 368s (~6 min). Not our code — BD infrastructure.
Then batch 1 took another 20s. Total to first visible post: ~388s (~6.5 min).

### Expected timing after PERF-4 fix

| Phase | Duration |
|---|---|
| BrightData (trigger + poll + download) | ~368s (~6 min) — unchanged |
| All 5 batches (BQ only, no blocking media) | ~20s total |
| **Total collection** | **~390s (~6.5 min)** |
| First batch visible | ~374s (vs ~388s before) |

The ~6 min BrightData latency is irreducible on our side. The only way to get posts faster
is to use BrightData's realtime/streaming APIs if available, or accept the latency.

### BQ media_refs UPDATE (always failing — removed)

Every batch spawned a background thread that tried to UPDATE `media_refs` with GCS URIs after
a 90s sleep. All 5 threads failed with streaming buffer error:
```
Failed to update media_refs in BQ: UPDATE over table posts would affect rows in the streaming buffer
```
The 90s wait is ineffective because the collection itself keeps inserting new rows, keeping
the streaming buffer alive throughout. These threads were pure noise. **Removed in PERF-4 fix.**
GCS URIs are available in-memory for enrichment; BQ media_refs will show CDN URLs (which work
fine for display). Re-enrichment from BQ would need a separate post-collection media sync job.

---

## Test Procedure

To validate a fix or measure performance:

1. Clear the log: `echo "" > logs/worker.log`
2. Start backend: `cd api && uvicorn main:app --reload`
3. Trigger a controlled collection (single platform, single keyword, explicit post count)
4. Wait for completion, then inspect `logs/worker.log`

**Key log lines to check:**
```
BD scrape: discover_by=keyword, inputs=N, limit=X        ← limit being sent
[platform] num_per_kw=X, expected_max=Y                  ← budget calculation
BD trigger completed in Xs                               ← trigger latency
BD snapshot <id> ready after Xs polling                  ← poll duration
Downloaded snapshot <id>: N records in Xs (attempt N)   ← download + retry count
BrightData <platform>: N posts → M sub-batches           ← parsed count
Batch N done in Xs — total=N posts, (bq=Xs, media=Xs)   ← per-batch timing
── Step 1 done in Xs                                     ← total collection time
── Step 2 done in Xs                                     ← total enrichment time
```
