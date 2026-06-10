# facebook video never downloaded — missing in UI + ignored by enrichment

## Symptom
- Facebook reels/videos show no playable video in the UI.
- Enrichment summaries/`detected_brands` for FB video posts reflect only the
  caption/title, never the visual content.

## Repro
- Collect a FB reel, e.g. `https://www.facebook.com/reel/4527978807480302/`.
- BQ row's `media_refs` = `[{media_type:"image", gcs_uri:"", original_url:"https://www.facebook.com/reel/<id>/"}]`
- Scope at time of fix: all 87 FB `post_type="video"` posts had 0 video refs, 0 reached GCS.

## Root cause
Chain in `workers/collection/media_downloader.py`:
1. The scrapeforge/apify actor returns the FB video as a **page URL**
   (`facebook.com/reel|videos|watch`), not a direct CDN `.mp4`.
2. Plain HTTP GET of that page fails (400/redirect) → no `gcs_uri`.
3. `_is_video_url()` doesn't match FB page URLs → URL fell to the image fallback,
   stored as `media_type:"image"` with the page URL as `original_url`.
4. `facebook` was not covered by any yt-dlp fallback (only TikTok had a page-URL
   fallback; `_YTDLP_PLATFORMS` = tiktok/reddit gate the inline CDN-video path).

Downstream: enricher (`enricher.py:_build_media_part`) sent the page URL as
`image/jpeg` to Gemini → Vertex can't fetch arbitrary https → silently dropped →
text-only enrichment. UI rendered the page URL as an `<img>` → broken/missing.
(Unlike YouTube, Gemini does NOT natively ingest FB URLs, so download is required.)

Secondary: yt-dlp on FB threw `IncompleteRead` on a single large GET.

## Fix
`workers/collection/media_downloader.py`:
- `_is_fb_video_page_url()` + `_needs_page_url_video_fallback(post)` (tiktok always;
  facebook when `post_type=="video"` or page-URL markers).
- Generalized the TikTok post-page yt-dlp fallback to also cover Facebook.
- Loop skips storing FB video page URLs as bogus image refs (deferred to yt-dlp).
- `_download_via_ytdlp` ydl_opts: `http_chunk_size=1MiB` + `retries`/`fragment_retries`
  → fixes FB `IncompleteRead`.

No enricher/UI change needed: video now lands in GCS as `media_type:"video"`, which
both already handle (same shape as TikTok/Reddit GCS videos).

## Regression test
`workers/collection/test_media_downloader.py` (4 tests). E2E verified: real reel →
yt-dlp → `media_type:"video"` GCS ref (19.8 MB mp4).

## Caveats / follow-up
- Only fixes **new** collections. Existing 87 FB video posts need a backfill
  re-download + re-enrichment (separate script).
- yt-dlp may fail on private/age-gated FB videos (needs cookies); public reels work.

## Fix commit
Branch `dev`, uncommitted at time of writing.
