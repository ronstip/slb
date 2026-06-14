import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { applyWidgetFilters } from './SocialWidgetRenderer.tsx';

// The `topics` widget filter is an any-of match on each post's `topic_ids`
// (topic cluster membership). It re-scopes the chart's DATA the same way themes
// or entities do - the Story Mode per-section baseline.

function p(over: Partial<DashboardPost>): DashboardPost {
  return { post_id: 'x', platform: 'x', channel_handle: 'c', posted_at: '', like_count: 0, view_count: 0, comment_count: 0, share_count: 0, ...over } as DashboardPost;
}

describe('applyWidgetFilters - topics dimension', () => {
  it('keeps only posts whose topic_ids intersect the selected topics', () => {
    const posts = [
      p({ post_id: 'a', topic_ids: ['clust-1'] }),
      p({ post_id: 'b', topic_ids: ['clust-2'] }),
      p({ post_id: 'c', topic_ids: ['clust-1', 'clust-3'] }),
    ];
    const out = applyWidgetFilters(posts, { topics: ['clust-1'] });
    expect(out.map((x) => x.post_id)).toEqual(['a', 'c']);
  });

  it('drops posts with no topic membership when a topic filter is set', () => {
    const posts = [
      p({ post_id: 'a', topic_ids: ['clust-1'] }),
      p({ post_id: 'b' }), // unclustered
    ];
    const out = applyWidgetFilters(posts, { topics: ['clust-1'] });
    expect(out.map((x) => x.post_id)).toEqual(['a']);
  });

  it('is a no-op when no topics are selected', () => {
    const posts = [p({ post_id: 'a' }), p({ post_id: 'b', topic_ids: ['clust-9'] })];
    expect(applyWidgetFilters(posts, {})).toHaveLength(2);
    expect(applyWidgetFilters(posts, { topics: [] })).toHaveLength(2);
  });

  it('intersects with another dimension (topic baseline + sentiment narrowing)', () => {
    const posts = [
      p({ post_id: 'a', topic_ids: ['clust-1'], sentiment: 'negative' }),
      p({ post_id: 'b', topic_ids: ['clust-1'], sentiment: 'positive' }),
    ];
    const out = applyWidgetFilters(posts, { topics: ['clust-1'], sentiment: ['negative'] });
    expect(out.map((x) => x.post_id)).toEqual(['a']);
  });
});
