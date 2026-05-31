import type { CommentItem } from '../../api/endpoints/posts.ts';

export interface ThreadNode {
  root: CommentItem;
  replies: CommentItem[];
}

/**
 * Group flat comment rows into root+replies threads.
 *
 * Backend convention: a top-level comment (direct reply to the post) has
 * `root_comment_id` either NULL or equal to its own `comment_id`. Nested
 * replies carry the ancestor's id. We must NOT treat a self-referential
 * root as a reply to itself, or it renders twice (root + its own reply).
 */
export function groupIntoThreads(rows: CommentItem[]): ThreadNode[] {
  const byRoot = new Map<string, CommentItem>();
  const replies = new Map<string, CommentItem[]>();
  for (const c of rows) {
    if (c.root_comment_id == null || c.root_comment_id === c.comment_id) {
      byRoot.set(c.comment_id, c);
    } else {
      const list = replies.get(c.root_comment_id) ?? [];
      list.push(c);
      replies.set(c.root_comment_id, list);
    }
  }
  // Orphan replies (root not in current batch) become their own thread.
  for (const c of rows) {
    if (
      c.root_comment_id != null &&
      c.root_comment_id !== c.comment_id &&
      !byRoot.has(c.root_comment_id)
    ) {
      byRoot.set(c.comment_id, c);
    }
  }
  const threads: ThreadNode[] = [];
  for (const [rootId, root] of byRoot) {
    const r = (replies.get(rootId) ?? []).slice().sort((a, b) => {
      return (a.commented_at ?? '').localeCompare(b.commented_at ?? '');
    });
    threads.push({ root, replies: r });
  }
  threads.sort((a, b) => (b.root.likes ?? 0) - (a.root.likes ?? 0));
  return threads;
}
