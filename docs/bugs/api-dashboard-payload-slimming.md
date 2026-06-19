# api/frontend — dashboard payload too large to scale (24MB raw / 8.5K posts)

## Symptom
Both dashboard surfaces (`POST /dashboard/data`, `GET /dashboard/shares/public/{token}`)
ship the **entire raw posts table** and aggregate client-side. Measured warm on
share `wc26brands` (8554 posts): **25.1MB raw** (gzips to 6.5MB wire), warm TTFB
~3.0s. Scales linearly → ~140MB at 50K posts. Continuation of the work in
`docs/handoff-dashboard-payload-scalability.md`.

## Diagnosis (measured, not assumed)
- Per-field byte audit of the live payload: the **display-only** fields
  `media_refs` (38%), `ai_summary` (14%), `context` (8%) = ~60% of post bytes,
  read ONLY for the bounded set of posts actually rendered — embed-gallery
  thumbnails (`embedPostThumbnail`), expanded table rows (`ExpandedPostRow`),
  and the `ai_summary` post-mode table COLUMN (bounded to `rowLimit`). None are
  used in aggregation or filtering, so all three are strippable + lazy-fetched.
- NOT stripped: `content` (11%) — filterable via the `text` condition
  (`matchesCondition` → `post.content`, `dashboard-aggregations.ts:925`), so the
  FE needs it per post.
- The displayed set is bounded per widget (`aggregateTablePostMode` →
  `rows.slice(0, rowLimit)`; `embedCandidatePosts` → top-N) BUT shifts with the
  interactive filter bar at runtime — so server-side "pre-bake top-N" is only
  correct on the share (filter bar hidden) and degrades on studio. Chosen design:
  **lazy-fetch on render** (correct under any filter state, no Python re-impl of
  FE widget logic).
- Warm cost split (isolated by identity vs gzip requests): gzip re-compression of
  25MB = ~1.0s/hit (uncached); firestore + orjson = the rest. Share did 36
  sequential* `get_collection_status` reads for the freshness stamp before the
  cache check (*already `asyncio.gather`-parallel, so the wall-clock win of
  batching is modest, but it cuts RPCs/billed reads and helps at high RTT).

## Fix
**P0a — batched freshness read.** New `FirestoreClient.get_collection_statuses()`
(`workers/shared/firestore_client.py`) collapses the per-collection freshness
reads into one `get_all` round-trip; share router uses it.

**P1 — payload slimming + lazy detail fetch.**
- `dashboard_service.DETAIL_FIELDS = (ai_summary, context, media_refs)`,
  `strip_detail_fields()` (non-mutating), `build_post_details()` (scoped to the
  cached core — the access boundary), and `get_or_build_core()` (shared core
  loader for all four paths so data + details hit the same cache).
- `/dashboard/data` accepts `slim: bool` (default False); share accepts `?slim=1`.
  When set, the heavy fields are stripped from the bulk payload.
- New detail endpoints serve the stripped fields per visible `post_id` from the
  same cached core (no extra BigQuery on a warm dashboard):
  `POST /dashboard/post-details` (authed) and
  `POST /dashboard/shares/public/{token}/post-details` (tokenless).
- **Guardrail-safe:** slimming is response-layer only; the shared `scope_posts`
  TVF / `build_dashboard_sql` are untouched.

**P1 FE — lazy fetch wired.** `use-post-details.tsx` (provider + `usePostDetails`
hook, batched/de-duped/cached fetch); endpoint clients `getDashboardPostDetails`
/ `getSharedPostDetails`; `slim` opt-in in `getDashboardData` (DashboardView sets
it) + `?slim=1` in `getSharedDashboardData`; `DashboardDetailsProvider` wraps the
grid in `SocialDashboardView` (fed by both hosts). Three consumers lazy-resolve:
`EmbedPostGallery` (`media_refs` thumbnails), `LazyExpandedPostRow`
(`context`/`media_refs`/`ai_summary` on expand), and `ConfigurableTableWidget`
(`ai_summary` post-mode column, merged for the displayed `rowLimit` rows).
Non-slim path unchanged (provider inert when no `fetch`); `StatsTab` +
agent-overview keep the full payload (slim is opt-in).

**Measured (live, share `wc26brands`, 8554 posts):** raw 25.1MB → 11.5MB (−54%),
gzip wire 6.5MB → 2.62MB (−60%). Detail endpoint returns
`{ai_summary, context, media_refs}` from the warm cache (no BigQuery).

## Tests
- `api/tests/test_collection_status_batch.py` — batched read contract.
- `api/tests/test_dashboard_detail_fields.py` — strip/build_post_details
  (exact fields, no mutation, scope safety).
- Full dashboard/share/report suite: **189 passed** after the refactor.

## Status / remaining
- P0a + P1 (BE + FE) **complete and live-verified**.
- Follow-ups (NOT done): **P0b** cache the gzipped bytes per (cache_key +
  report_config) to skip the ~0.35s orjson+gzip re-encode on warm hits; **P2**
  server-side aggregation to remove the O(N) payload entirely. See
  `docs/handoff-dashboard-payload-scalability.md` for the next-session brief.

## Commit / branch
Branch `WidgetsAndBugFix` (uncommitted at time of writing).
