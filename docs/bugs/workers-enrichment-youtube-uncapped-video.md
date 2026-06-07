# workers-enrichment-youtube-uncapped-video

## Symptom
High Gemini billing during enrichment. Suspected YouTube long-video processing.

## Repro
Enrich a YouTube post with no GCS-stored video (the common case — YT videos are
usually not downloaded to GCS, so the direct-URL path fires). Long video (>180s)
gets sent to Gemini in full.

## Root cause
Two video paths in `workers/enrichment/enricher.py::_build_content_parts`:
- GCS-stored video (`_build_media_part`) sets `types.VideoMetadata`
  (`start_offset=0s`, `end_offset=180s`, `fps=0.5`) → bounded.
- YouTube direct-URL path used `types.Part.from_uri(file_uri=post.post_url, ...)`
  with **no `video_metadata`**. Gemini then defaults to full-length video at
  1 fps. A 30-min video = 1800 frames vs the 90-frame cap → ~20× tokens (40× at 1hr).

The duration/fps constraints we believed protected us never applied to YouTube.

## Fix
YouTube path now builds an explicit `types.Part` with the same `VideoMetadata`
(start/end offset + fps from settings) as the GCS path.

## Regression test
`workers/enrichment/test_enricher.py`:
- `test_youtube_url_part_has_bounded_video_metadata`
- `test_youtube_url_part_omitted_when_video_skipped`

## Fix commit
Branch `main`, uncommitted at time of writing.
