# api — `include_comments=True` collects 0 comments for X (twitter) agent runs

## Symptom
Agent runs on X with `include_comments=True` (both the keyword `dispatch_agent_run`
path and the direct-URL `fetch_posts_by_url` path) finish `success` with posts
collected + enriched but **0 rows in `social_listening.comments`** for those posts.
System-wide, the last `twitter` comment row is dated 2026-06-01 — i.e. X reply
collection has effectively not run for ~26 days, while `facebook` comments are
recent (2026-06-23).

## Repro (2026-06-27, agent 028543a6 — Israel-Lebanon first-reactions)
1. `fetch_posts_by_url(agent, urls=[14 X post URLs], include_comments=True)` →
   collection `09dda596…` completes `success`, `posts_collected=14`, but
   `SELECT COUNT(*) FROM comments WHERE post_id IN (those 14)` = **0**.
2. Calling the adapter directly works fine:
   `DataProviderWrapper().fetch_comments("twitter", {post_id, platform, post_url})`
   returns **98 replies / 96 authors** for one of the same posts.
   A loop over all 14 parents fetched **793 non-empty replies**.

## Root cause (CONFIRMED)
The X adapter reply path is healthy (`fetch_comments` → `/2/tweets/search/all`
`conversation_id:<id>`, `supported_comment_platforms()==["twitter"]`), and the
comments worker (`workers/comments/worker.py::fetch_post_comments`) writes
`comments` + `channels` correctly when invoked. The break is that **nothing in the
collection/agent pipeline ever enqueues that worker.** The ONLY caller is the
manual per-post endpoint `api/routers/posts.py:216 fetch_post_comments_endpoint`
(the UI "fetch comments" button), which spawns a thread per single post. The X
keyword/agent collection pipeline and the URL-fetch path thread `include_comments`
into the collection config + cost estimate (`collection_service.py` L55/92/217,
`cost_estimate.py` L78/127) but there is **no enqueue site** that fans out one
comments task per collected post. FB comments only populate because Apify's
`facebook-comments-scraper` pulls them INLINE during collection — a different path
that doesn't touch the comments worker. So for X (and any worker-based comment
platform), `include_comments=True` on an agent run is a silent no-op.

## Fix (proper)
In the collection pipeline, after posts are collected+persisted, if
`config.include_comments` and `platform in adapter.supported_comment_platforms()`,
fan out one Cloud Task per post to the comments worker route (`workers/server.py`
L175 `/…comments…`) with `{post_id, collection_id, agent_id, platform, post_url,
user_id, org_id}`. Mirror the engagement-worker fan-out. Then a comment-enrichment
pass to populate `enriched_comments`.

## Workaround applied (2026-06-27)
Called `fetch_post_comments` directly (prod creds) for the 14 parents →
**794 rows persisted** to `social_listening.comments`. Data page now shows them.
`enriched_comments` NOT yet populated (raw comments only).

## Workaround used
Bypassed the pipeline: looped `wrapper.fetch_comments` over the 14 parents and
enriched the replies in-memory via `enrich_posts(..., comment_mode=True)`. Worked
(793 fetched, 615 related). Comments were NOT persisted to BQ this way.

## Fix
Not committed. Next: trace what enqueues `workers/comments/worker.py`, confirm
whether the keyword pipeline ever fires it for X, and gate the URL-fetch path to
enqueue it too. Add a regression test asserting a twitter collection with
`include_comments=True` writes ≥1 `comments` row (mock adapter).

## Regression test
TODO — none yet.
