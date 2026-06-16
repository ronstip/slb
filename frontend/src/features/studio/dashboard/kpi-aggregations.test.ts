import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { aggregateCustom } from './dashboard-aggregations.ts';

// New number-card (no Group-By) aggregations beyond sum/avg/min/max/count:
//  - median: median of the numeric metric
//  - distinct: distinct-value count of a categorical field
//  - mode: most frequent value of a categorical field ("Top value") → string
//  - percent: metric over these posts ÷ same metric over a baseline set

function p(over: Partial<DashboardPost>): DashboardPost {
  return {
    post_id: 'x', platform: 'x', channel_handle: 'c', posted_at: '',
    like_count: 0, view_count: 0, comment_count: 0, share_count: 0,
    ...over,
  } as DashboardPost;
}

describe('aggregateCustom - number-card aggregations', () => {
  describe('median', () => {
    it('returns the middle value for an odd count', () => {
      const posts = [p({ like_count: 1 }), p({ like_count: 5 }), p({ like_count: 3 })];
      const out = aggregateCustom(posts, { metric: 'like_count', metricAgg: 'median' });
      expect(out.value).toBe(3);
    });

    it('averages the two middle values for an even count', () => {
      const posts = [p({ like_count: 1 }), p({ like_count: 2 }), p({ like_count: 3 }), p({ like_count: 6 })];
      const out = aggregateCustom(posts, { metric: 'like_count', metricAgg: 'median' });
      expect(out.value).toBe(2.5);
    });

    it('is 0 for no posts', () => {
      const out = aggregateCustom([], { metric: 'like_count', metricAgg: 'median' });
      expect(out.value).toBe(0);
    });
  });

  describe('distinct', () => {
    it('counts distinct values of the categorical field', () => {
      const posts = [
        p({ platform: 'x' }), p({ platform: 'x' }),
        p({ platform: 'reddit' }), p({ platform: 'tiktok' }),
      ];
      const out = aggregateCustom(posts, {
        metric: 'post_count', metricAgg: 'distinct', categoricalField: 'platform',
      });
      expect(out.value).toBe(3);
    });

    it('counts distinct values of a multi-valued field once each', () => {
      const posts = [
        p({ themes: ['a', 'b'] } as Partial<DashboardPost>),
        p({ themes: ['b', 'c'] } as Partial<DashboardPost>),
      ];
      const out = aggregateCustom(posts, {
        metric: 'post_count', metricAgg: 'distinct', categoricalField: 'themes',
      });
      expect(out.value).toBe(3); // a, b, c
    });
  });

  describe('mode (top value)', () => {
    it('returns the most frequent value as stringValue with its count', () => {
      const posts = [
        p({ sentiment: 'positive' } as Partial<DashboardPost>),
        p({ sentiment: 'positive' } as Partial<DashboardPost>),
        p({ sentiment: 'negative' } as Partial<DashboardPost>),
      ];
      const out = aggregateCustom(posts, {
        metric: 'post_count', metricAgg: 'mode', categoricalField: 'sentiment',
      });
      expect(out.stringValue).toBe('positive');
      expect(out.value).toBe(2);
      // valueTotal is the percentage base (posts with a value).
      expect(out.valueTotal).toBe(3); // 2/3 → 66.7%
    });

    it('excludes posts with a missing value from the top value and the base', () => {
      const posts = [
        p({ sentiment: 'positive' } as Partial<DashboardPost>),
        p({ sentiment: 'positive' } as Partial<DashboardPost>),
        p({ sentiment: undefined } as Partial<DashboardPost>), // missing → 'unknown', ignored
      ];
      const out = aggregateCustom(posts, {
        metric: 'post_count', metricAgg: 'mode', categoricalField: 'sentiment',
      });
      expect(out.stringValue).toBe('positive');
      expect(out.value).toBe(2);
      expect(out.valueTotal).toBe(2); // 2/2 → 100%, not 2/3
    });
  });

  describe('percent', () => {
    it('is the metric share of the baseline set', () => {
      const posts = [p({ like_count: 10 }), p({ like_count: 10 })]; // sum 20
      const base = [
        p({ like_count: 10 }), p({ like_count: 10 }),
        p({ like_count: 30 }), p({ like_count: 30 }),
      ]; // sum 80
      const out = aggregateCustom(posts, { metric: 'like_count', metricAgg: 'percent' }, undefined, base);
      expect(out.value).toBe(25); // 20 / 80
      expect(out.format).toBe('percent');
    });

    it('falls back to the posts themselves as baseline (→ 100%)', () => {
      const posts = [p({ like_count: 5 }), p({ like_count: 5 })];
      const out = aggregateCustom(posts, { metric: 'like_count', metricAgg: 'percent' });
      expect(out.value).toBe(100);
    });

    it('is 0 when the baseline total is 0', () => {
      const out = aggregateCustom([p({ like_count: 0 })], { metric: 'like_count', metricAgg: 'percent' });
      expect(out.value).toBe(0);
    });
  });
});
