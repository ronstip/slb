# FB group posts: channel = group name (not author) + comments unsupported

**Area:** workers (Apify Facebook group collection)
**Branch:** dev (uncommitted at time of writing)

## Symptoms
1. Every FB group post's `channel_handle` was the GROUP name (e.g. "Dog Spotting"),
   not the member who wrote the post. Real author was buried in
   `platform_metadata.author_id/author_name`. No handling for anonymous group posts.
2. "Fetch comments" failed for all Facebook posts (pages + groups).

## Root cause
1. `parse_apify_facebook_group_post` (workers/collection/adapters/apify_parsers.py)
   deliberately set `channel_handle=group_title`, `channel_id=group_id`. The
   `parse_apify_facebook_group_channel` snapshot was the group too. This disagreed
   with BrightData's FB-group parser (author in channel) and with the standard
   meaning of "channel" = the post author.
2. Facebook was absent from two gates: `_COMMENTS_SUPPORTED_PLATFORMS`
   (api/routers/posts.py) and ApifyAdapter `_COMMENTS_CONFIG` — so
   `fetch_comments` raised `NotImplementedError`. Not group-specific; FB had no
   comments actor wired at all.

## Fix
1. New helper `_fb_group_author(item, group_title)`. Post + channel parsers now set
   channel = author; group moves to `platform_metadata` / `channel_metadata`
   (`group_id`, `group_title`, `group_url`). Anonymous posts get
   `channel_handle = "Anonymous · <group>"`, `platform_metadata.is_anonymous=True`
   — anon scoped per-group so they don't collapse into one synthetic channel.

   Anon detection (confirmed against a real `apify/facebook-groups-scraper` run on
   group `smartflights`): the actor emits anon posters as
   `user = {"name": "Anonymous participant", "id": <distinct-per-post id>}` — a
   LITERAL name marker with a unique id, NOT a missing author block. So
   `_fb_group_author` treats both the absent-author case AND the
   `_FB_ANON_NAME_MARKERS` set ("anonymous participant"/"member"/"anonymous") as
   anonymous. The per-post id is kept (channel_id) so distinct anon posters stay
   distinct; only the absent-author case yields channel_id=None. FB's
   auto-generated handles (e.g. "IndigoOtter1990") are real authors, not anon.
2. Wired FB comments via `apify/facebook-comments-scraper`:
   - settings: `apify_actor_facebook_comments`, `apify_facebook_comments_max`
   - parsers: `parse_apify_facebook_comment`, `parse_apify_facebook_comment_author`,
     `flatten_apify_facebook_comments` (threads nested `replies`)
   - added `facebook` entry to `_COMMENTS_CONFIG` (startUrls=[{url}], resultsLimit)
   - added `facebook` to `_COMMENTS_SUPPORTED_PLATFORMS`
   Routing is automatic: `supported_comment_platforms()` derives from
   `_COMMENTS_CONFIG`; wrapper picks Apify since BrightData exposes no comments.

## Regression tests
- workers/collection/adapters/test_apify_parsers.py — channel=author,
  anonymous author, group-in-metadata, FB comment flatten/author.
- workers/collection/adapters/test_apify_tiktok_comments.py —
  `test_fetch_comments_facebook_dispatches_to_actor` (replaced the old
  "still unsupported" test).

## Follow-up / debt
- BrightData FB-group parser still sets `channel_id=group_id` while
  channel_handle=username — mildly inconsistent with the new author-as-channel
  model. Not the active route (Apify handles FB groups), left as-is.
- FB comments actor output schema is modeled defensively; verify field names
  (`profileId`/`profileName`/`replyToCommentId`) against a real actor run.
