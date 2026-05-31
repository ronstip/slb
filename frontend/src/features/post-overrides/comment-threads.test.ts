import { describe, it, expect } from 'vitest';
import { groupIntoThreads } from './comment-threads.ts';
import type { CommentItem } from '../../api/endpoints/posts.ts';

function mk(over: Partial<CommentItem> & { comment_id: string }): CommentItem {
  return {
    root_comment_id: null,
    channel_handle: 'user',
    channel_id: null,
    content: 'x',
    commented_at: null,
    likes: 0,
    replies_count: 0,
    views: 0,
    ...over,
  };
}

describe('groupIntoThreads', () => {
  it('does not render a self-referential root as its own reply', () => {
    // Backend sets root_comment_id == comment_id for top-level comments.
    const rows = [mk({ comment_id: 'c1', root_comment_id: 'c1' })];
    const threads = groupIntoThreads(rows);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.comment_id).toBe('c1');
    expect(threads[0].replies).toHaveLength(0);
  });

  it('handles NULL root_comment_id as top-level', () => {
    const rows = [mk({ comment_id: 'c1', root_comment_id: null })];
    const threads = groupIntoThreads(rows);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(0);
  });

  it('nests a real reply under its self-referential root', () => {
    const rows = [
      mk({ comment_id: 'c1', root_comment_id: 'c1', commented_at: '2024-01-01T10:00:00Z' }),
      mk({ comment_id: 'c2', root_comment_id: 'c1', commented_at: '2024-01-01T10:05:00Z' }),
    ];
    const threads = groupIntoThreads(rows);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.comment_id).toBe('c1');
    expect(threads[0].replies.map((r) => r.comment_id)).toEqual(['c2']);
  });

  it('promotes an orphan reply (root not in batch) to its own thread', () => {
    const rows = [mk({ comment_id: 'c2', root_comment_id: 'missing' })];
    const threads = groupIntoThreads(rows);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.comment_id).toBe('c2');
    expect(threads[0].replies).toHaveLength(0);
  });

  it('sorts threads by root likes desc', () => {
    const rows = [
      mk({ comment_id: 'a', root_comment_id: 'a', likes: 1 }),
      mk({ comment_id: 'b', root_comment_id: 'b', likes: 5 }),
    ];
    const threads = groupIntoThreads(rows);
    expect(threads.map((t) => t.root.comment_id)).toEqual(['b', 'a']);
  });
});
