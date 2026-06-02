# frontend - comments shown as reply to themselves

## Symptom
In the comments drawer, every top-level comment rendered twice: once as the
root and again indented as a "reply" to itself (same handle + same text).

## Repro
1. Open a post's comments drawer for a post with fetched comments.
2. Observe each root comment duplicated at depth 0 and depth 1.

## Root cause
Data-convention mismatch between backend and frontend.

The backend (`workers/collection/adapters/comment_threading.py:resolve_comment_roots`)
sets `root_comment_id == comment_id` for top-level comments (direct replies to
the post) - it is never NULL. The frontend `groupIntoThreads` assumed top-level
meant `root_comment_id == null`. So a self-referential root:
- never matched the `== null` branch → got pushed into `replies[comment_id]`
  (a reply to itself), and
- the orphan-promotion loop then also added it to `byRoot`.

Result: rendered once as root, once as its own reply.

## Fix
Treat a comment as top-level when `root_comment_id == null` **or**
`root_comment_id === comment_id`, and exclude self-references from both the
replies map and the orphan-promotion loop.

Also extracted the pure `groupIntoThreads` / `ThreadNode` out of
`CommentsDrawer.tsx` into `frontend/src/features/post-overrides/comment-threads.ts`
so it can be unit-tested without pulling the React/UI tree (vitest has no `@`
alias and runs in the `node` env).

## Regression test
`frontend/src/features/post-overrides/comment-threads.test.ts` - covers
self-referential root (no self-reply), NULL root, real nested reply, orphan
promotion, and likes-desc ordering. Confirmed red against old logic (2 failing),
green after fix.

## Fix commit
Not yet committed (branch `dev`).
