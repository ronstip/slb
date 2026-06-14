import { describe, it, expect } from 'vitest';
import { analyticsStatsFromFeedKpis } from './AnalyticsStrip.tsx';
import type { FeedKpis } from '../../api/types.ts';

// Regression: the data tab once computed its KPI strip from the downloaded post
// array, which a perf change capped at 500 rows - so an agent with 4,737 posts
// reported "500 posts" and skewed every breakdown. The strip now consumes these
// full-window server aggregates instead.
const kpis: FeedKpis = {
  total_posts: 4737,
  total_views: 1_000_000,
  total_likes: 50_000,
  total_comments: 9474,
  total_shares: 1000,
  unique_handles: 321,
  platforms: [
    { value: 'tiktok', count: 3000 },
    { value: 'instagram', count: 1737 },
  ],
  sentiments: [
    { value: 'positive', count: 2000 },
    { value: 'neutral', count: 2737 },
  ],
  top_themes: [{ value: 'pricing', count: 120 }],
  top_entities: [{ value: 'Acme', count: 80 }],
};

describe('analyticsStatsFromFeedKpis', () => {
  it('reports the full-window post count, not the downloaded page size', () => {
    expect(analyticsStatsFromFeedKpis(kpis).totalPosts).toBe(4737);
  });

  it('carries through totals and derives averages over the full count', () => {
    const s = analyticsStatsFromFeedKpis(kpis);
    expect(s.totalViews).toBe(1_000_000);
    expect(s.totalLikes).toBe(50_000);
    expect(s.totalComments).toBe(9474);
    expect(s.uniqueHandles).toBe(321);
    expect(s.avgViews).toBe(Math.round(1_000_000 / 4737));
    expect(s.avgComments).toBe(Math.round(9474 / 4737));
  });

  it('maps breakdowns into the strip shape (name/count)', () => {
    const s = analyticsStatsFromFeedKpis(kpis);
    expect(s.platforms.map((p) => [p.name, p.count])).toEqual([
      ['tiktok', 3000],
      ['instagram', 1737],
    ]);
    expect(s.sentiments[0].name).toBe('positive');
    expect(s.topThemes).toEqual([{ name: 'pricing', count: 120 }]);
    expect(s.topEntities).toEqual([{ name: 'Acme', count: 80 }]);
  });

  it('does not divide by zero when there are no posts', () => {
    const empty = analyticsStatsFromFeedKpis({
      ...kpis,
      total_posts: 0,
      total_views: 0,
      total_likes: 0,
      total_comments: 0,
    });
    expect(empty.avgViews).toBe(0);
    expect(empty.totalPosts).toBe(0);
  });
});
