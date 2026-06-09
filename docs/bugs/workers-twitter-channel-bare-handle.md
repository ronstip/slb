# workers — Twitter channel collection returns 0 posts for bare @handles

## Repro
1. Agent → Settings → Data Sources → Twitter/X source.
2. Add channels as `@ESPN` or `ESPN` (bare handles — what the "Profile URL or @handle" placeholder invites).
3. Save, click Refresh/Play.
4. Collection runs but stores 0 posts (and the agent-wide clustering still fires, looking active).

## Root cause
`extract_twitter_username` (`workers/collection/adapters/x_api_parsers.py`) only matched
`twitter.com/<h>` / `x.com/<h>` URLs. A bare handle returned `None`, so the X adapter built
zero `user_timeline` tasks → 0 posts. The channel input UI accepts handles, so the extractor
must too.

## Fix
`extract_twitter_username` now accepts a profile URL, `@handle`, or bare `handle` (strips `@`,
rejects reserved paths like `search`/`home`). Also added analogous normalization for the
Apify channel paths (`_normalize_ig_profile_url`, `_normalize_tiktok_profile` in
`workers/collection/adapters/apify.py`) so IG/TikTok channels don't hit the same trap.

## Regression test
`workers/collection/adapters/test_x_api_adapter.py::test_extract_twitter_username_accepts_urls_and_bare_handles`
plus the channel task-building tests (`test_channel_with_keyword_builds_from_search`,
`test_channel_only_builds_user_timeline`).

## Fix commit
Branch `dev` (channel-collection feature), not yet committed at time of writing.
