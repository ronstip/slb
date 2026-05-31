# workers — data-page media empty (expiring CDN URLs, gcs_uri never persisted)

## Symptom
Data page → posts table → expand row → image/video shows empty/broken for most
posts, across many platforms (TikTok, Instagram, YouTube). Reddit/Twitter often
fine. Text-only posts correctly show nothing.

## Repro
Open data page, expand posts collected >1 day ago on TikTok/Instagram. Media box
is empty/broken.

## Root cause (two compounding bugs)
1. **Display source was the raw, signed CDN `original_url`.** Frontend
   `resolveUrl()` ([PostCard.tsx](../../frontend/src/features/studio/PostCard.tsx#L187))
   uses our proxied `gcs_uri` if present, else embeds `original_url` directly.
   TikTok/Instagram/YouTube CDN URLs are signed + time-limited (`x-expires`,
   `oe=`) → they 403 within ~24-48h. The `/media-proxy` fallback can't rescue an
   expired URL (server fetch also 403 → 404). Reddit (`i.redd.it`) / Twitter
   (`pbs.twimg.com`) use stable unsigned URLs, so they keep working.

2. **`gcs_uri` (our durable copy) was missing for most posts in BQ.** Posts were
   stream-inserted with seed refs (`original_url` only). Media download to GCS
   ran *after* insert and wrote `gcs_uri` back via
   `UPDATE social_listening.posts`. BQ forbids DML on rows still in the streaming
   buffer (up to ~90 min); the writeback retried only ~65s
   (`_update_bq_media_refs`) then gave up. Fast pipelines → `gcs_uri` never
   landed → posts stuck forever on the expiring CDN link.

BQ measured gcs_uri coverage: tiktok 29%, instagram 30%, reddit 2%, youtube 6%,
twitter 17%.

## Fix
Download media to GCS **before** the BQ posts insert so the row carries durable
`gcs_uri` refs at insert time — no post-insert UPDATE, no streaming-buffer race.
- `workers/pipeline/runner.py`: replaced the seed-CDN-refs block in the crawl
  loop with `download_media_batch(self.gcs, new_posts, ...)` before
  `insert_rows("posts", ...)`; pass `media_resolved=True` to `mark_collected`.
- `workers/pipeline/state_manager.py`: `mark_collected(media_resolved=True)`
  routes media posts straight to `READY_FOR_ENRICHMENT`, skipping the
  `COLLECTED_WITH_MEDIA` → download streaming step (still used for
  continuation/recovery where media may not be in GCS yet).

## Regression test
`workers/pipeline/test_state_manager_dep.py::test_media_resolved_skips_download_state`

## Notes
- Historical posts already in BQ with expired CDN refs are **not recoverable**
  by this change (their signed URLs are dead); only re-crawl repopulates them.
- Out-of-range posts also get media downloaded now (inserted in same batch).
- `_reconcile_bq_media_refs` / `_update_bq_media_refs` remain as the
  continuation-path safety net but are redundant in the normal flow.

## Fix commit
branch `dev` (uncommitted at time of writing)
