"""Platform-neutral helpers for assembling comment thread trees.

`resolve_comment_roots` walks the `replied_to_id` chain on each Comment and
stamps `root_comment_id` so the UI can group replies under their top-level
parent. The same algorithm works for any platform that exposes a direct
parent-comment id (X via `referenced_tweets[type=replied_to]`, Instagram
via `parentId` / nested `replies`, etc.).
"""

from __future__ import annotations

from workers.collection.models import Comment


def resolve_comment_roots(comments: list[Comment], post_id: str) -> None:
    """Set `root_comment_id` on each comment in-place.

    Root = the in-batch ancestor whose `replied_to_id == post_id` (a direct
    reply to the original post). A comment that itself replies to the post
    is its own root. If the chain can't be resolved within the batch (the
    middle ancestor wasn't paged in), fall back to root = self so the row
    is never NULL.
    """
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        cur = c
        visited: set[str] = set()
        while True:
            if cur.comment_id in visited:
                # Cycle - defensive; well-formed platforms shouldn't produce one.
                c.root_comment_id = c.comment_id
                break
            visited.add(cur.comment_id)
            if not cur.replied_to_id or cur.replied_to_id == post_id:
                c.root_comment_id = cur.comment_id
                break
            parent = by_id.get(cur.replied_to_id)
            if parent is None:
                # Ancestor not in this batch - fall back to self.
                c.root_comment_id = c.comment_id
                break
            cur = parent
