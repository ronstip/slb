import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { aggregateTable, aggregateTableBreakdown, BREAKDOWN_DIM_ID } from './dashboard-aggregations.ts';
import type { CustomTableConfig } from './types-social-dashboard.ts';

function p(over: Partial<DashboardPost>): DashboardPost {
  return {
    post_id: 'x', platform: 'instagram', channel_handle: 'c', posted_at: '2026-01-01T00:00:00Z',
    like_count: 0, view_count: 0, comment_count: 0, share_count: 0,
    ...over,
  } as DashboardPost;
}

// Group by platform, metric = post_count, break down by sentiment.
const config: CustomTableConfig = {
  mode: 'group',
  columns: [
    { id: 'g', kind: 'dimension', dimension: 'platform' },
    { id: 'posts', kind: 'metric', metric: 'post_count' },
  ],
  sortBy: 'posts',
  sortDir: 'desc',
  breakdownDimension: 'sentiment',
};

const posts = [
  p({ post_id: 'a', platform: 'instagram', sentiment: 'positive' }),
  p({ post_id: 'b', platform: 'instagram', sentiment: 'positive' }),
  p({ post_id: 'c', platform: 'instagram', sentiment: 'negative' }),
  p({ post_id: 'd', platform: 'tiktok', sentiment: 'positive' }),
];

describe('aggregateTableBreakdown', () => {
  it('returns empty when no breakdownDimension', () => {
    const { breakdownDimension: _d, ...noBd } = config;
    expect(aggregateTableBreakdown(posts, noBd).size).toBe(0);
  });

  it('keys breakdown rows by the parent group key from aggregateTable', () => {
    const groupRows = aggregateTable(posts, config);
    const map = aggregateTableBreakdown(posts, config);
    for (const row of groupRows) {
      expect(map.has(row.__key)).toBe(true);
    }
  });

  it('splits each group by the breakdown dimension with correct metric sums', () => {
    const map = aggregateTableBreakdown(posts, config);
    const ig = map.get('instagram')!;
    expect(ig).toBeDefined();
    // instagram: positive=2, negative=1; sorted desc by posts
    expect(ig.map((r) => [r[BREAKDOWN_DIM_ID], r.posts])).toEqual([
      ['positive', 2],
      ['negative', 1],
    ]);
    const tt = map.get('tiktok')!;
    expect(tt.map((r) => [r[BREAKDOWN_DIM_ID], r.posts])).toEqual([['positive', 1]]);
  });

  it('ignores post-mode tables', () => {
    expect(aggregateTableBreakdown(posts, { ...config, mode: 'post' }).size).toBe(0);
  });
});
