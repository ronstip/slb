# workers — YouTube channel collection returned 0 posts (wrong BrightData dataset)

## Repro
1. Agent → Settings → Data Sources → YouTube source.
2. Add a channel (e.g. `https://www.youtube.com/@NASA`), save, click Refresh/Play.
3. Collection runs but stores 0 posts.

## Root cause
`_collect_youtube_channels` (`workers/collection/adapters/brightdata.py`) targeted the
youtube **profiles** dataset (`gd_lk538t2k2p1k3oos71`) and additionally sent
`start_date`/`end_date`/`num_of_posts`, which that dataset rejects with a 400
(`This input should not contain a start_date field`). Two compounding problems:

1. The 400 meant zero records came back at all.
2. Even with a valid input the profiles dataset returns a single **channel-metadata**
   record (name, subscribers, `videos_count`, `top_videos: []`) — NOT the channel's
   videos — so it can never yield parseable posts.

## Fix
Route YouTube channel collection to the youtube **posts** dataset
(`gd_lk56epmy2i5g7lzu0k`, the same one the keyword path uses) in URL-discovery mode:
`scrape_type="discover_new"`, `discover_by="url"`, input `{"url": channel_url,
"num_of_posts": n}`. This returns the per-video schema the existing
`parse_brightdata_youtube_post` already handles. The date window is enforced
downstream by the pipeline's `partition_by_time_range` gate (URL discovery doesn't
accept date fields). Verified live: `@NASA` → 10 videos parsed with channel_handle /
posted_at / content.

## Regression test
`workers/collection/adapters/test_brightdata_adapter.py::test_youtube_channel_uses_posts_dataset_url_discovery`
asserts the posts dataset + `discover_by="url"` + url/num_of_posts input shape (and no
date fields).

## Fix commit
Branch `dev` (channel-collection feature), not yet committed at time of writing.
