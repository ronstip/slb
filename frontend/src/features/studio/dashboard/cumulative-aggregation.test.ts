import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { aggregateCustom } from './dashboard-aggregations.ts';

// `cumulative` on a time-series line chart turns per-bucket values into a
// running total. It only applies to time dimensions (posted_at); categorical
// charts ignore it. Must work for both single-series and grouped (breakdown)
// line charts so the running total survives into shared / Brief dashboards.

function p(over: Partial<DashboardPost>): DashboardPost {
  return { post_id: 'x', platform: 'x', channel_handle: 'c', posted_at: '', ...over } as DashboardPost;
}

describe('aggregateCustom - cumulative time series', () => {
  const posts = [
    p({ post_id: 'a', posted_at: '2026-01-01T00:00:00Z' }),
    p({ post_id: 'b', posted_at: '2026-01-02T00:00:00Z' }),
    p({ post_id: 'c', posted_at: '2026-01-02T00:00:00Z' }),
    p({ post_id: 'd', posted_at: '2026-01-03T00:00:00Z' }),
  ];

  it('returns a running total for a single-series time chart', () => {
    const out = aggregateCustom(posts, {
      dimension: 'posted_at',
      metric: 'post_count',
      timeBucket: 'day',
      cumulative: true,
    });
    // per-bucket would be [1, 2, 1]; cumulative → [1, 3, 4]
    expect(out.values).toEqual([1, 3, 4]);
    expect(out.timeSeries?.map((t) => t.value)).toEqual([1, 3, 4]);
  });

  it('leaves per-bucket values when cumulative is unset', () => {
    const out = aggregateCustom(posts, {
      dimension: 'posted_at',
      metric: 'post_count',
      timeBucket: 'day',
    });
    expect(out.values).toEqual([1, 2, 1]);
  });

  it('accumulates each grouped series independently', () => {
    const grouped = [
      p({ post_id: 'a', posted_at: '2026-01-01T00:00:00Z', platform: 'x' }),
      p({ post_id: 'b', posted_at: '2026-01-02T00:00:00Z', platform: 'x' }),
      p({ post_id: 'c', posted_at: '2026-01-01T00:00:00Z', platform: 'reddit' }),
      p({ post_id: 'd', posted_at: '2026-01-03T00:00:00Z', platform: 'reddit' }),
    ];
    const out = aggregateCustom(grouped, {
      dimension: 'posted_at',
      metric: 'post_count',
      breakdownDimension: 'platform',
      timeBucket: 'day',
      cumulative: true,
    });
    // x: per-bucket [1,1,0] → [1,2,2]; reddit: [1,0,1] → [1,1,2]
    expect(out.groupedTimeSeries?.x.map((d) => d.value)).toEqual([1, 2, 2]);
    expect(out.groupedTimeSeries?.reddit.map((d) => d.value)).toEqual([1, 1, 2]);
  });

  it('ignores cumulative on a categorical (non-time) chart', () => {
    const out = aggregateCustom(posts, {
      dimension: 'platform',
      metric: 'post_count',
      cumulative: true,
    });
    expect(out.values).toEqual([4]);
  });
});
