import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { aggregateHeatmap, getDimensionKeys } from './dashboard-aggregations.ts';
import { HOUR_OF_DAY_LABELS, DAY_OF_WEEK_LABELS } from './types-social-dashboard.ts';

// The heatmap widget is `aggregation: 'custom'` + `chartType: 'heatmap'`: a 2D
// pivot (Group By = X axis × Breakdown = Y axis → metric) rendered as a grid of
// intensity-shaded cells. `aggregateHeatmap` produces the same
// `WidgetData.groupedCategorical` shape the bar chart's breakdown path uses
// (labels = X columns, datasets = Y rows), but with natural ordering for the
// cyclical time dimensions and a FULL grid (every hour/weekday slot present even
// when its count is 0) so the matrix reads like the posting-activity design.

function p(over: Partial<DashboardPost>): DashboardPost {
  return {
    post_id: 'x', platform: 'x', channel_handle: 'c', posted_at: '',
    like_count: 0, view_count: 0, comment_count: 0, share_count: 0,
    ...over,
  } as DashboardPost;
}

describe('getDimensionKeys - cyclical time dimensions', () => {
  // 2026-01-05 is a Monday. Use local-time fields (matches bucketDate('hour')).
  const monday9am = '2026-01-05T09:30:00';

  it('derives hour_of_day as a zero-padded 2-digit hour', () => {
    expect(getDimensionKeys(p({ posted_at: monday9am }), 'hour_of_day', 'day')).toEqual(['09']);
    expect(getDimensionKeys(p({ posted_at: '2026-01-05T00:00:00' }), 'hour_of_day', 'day')).toEqual(['00']);
    expect(getDimensionKeys(p({ posted_at: '2026-01-05T23:00:00' }), 'hour_of_day', 'day')).toEqual(['23']);
  });

  it('derives day_of_week as a Mon-first weekday label', () => {
    expect(getDimensionKeys(p({ posted_at: monday9am }), 'day_of_week', 'day')).toEqual(['Mon']);
    expect(getDimensionKeys(p({ posted_at: '2026-01-11T12:00:00' }), 'day_of_week', 'day')).toEqual(['Sun']);
  });

  it('returns no key for a missing timestamp', () => {
    expect(getDimensionKeys(p({ posted_at: '' }), 'hour_of_day', 'day')).toEqual([]);
    expect(getDimensionKeys(p({ posted_at: '' }), 'day_of_week', 'day')).toEqual([]);
  });
});

describe('aggregateHeatmap', () => {
  const posts = [
    // Mon 09:00 ×2, Mon 10:00 ×1, Tue 09:00 ×1
    p({ post_id: 'a', posted_at: '2026-01-05T09:15:00', view_count: 100 }),
    p({ post_id: 'b', posted_at: '2026-01-05T09:45:00', view_count: 300 }),
    p({ post_id: 'c', posted_at: '2026-01-05T10:05:00', view_count: 50 }),
    p({ post_id: 'd', posted_at: '2026-01-06T09:00:00', view_count: 20 }),
  ];

  it('builds a full grid in canonical order for hour × weekday (post_count)', () => {
    const out = aggregateHeatmap(posts, {
      dimension: 'hour_of_day',
      breakdownDimension: 'day_of_week',
      metric: 'post_count',
    });
    const gc = out.groupedCategorical!;
    // X axis = all 24 hours in order; Y axis (datasets) = all 7 weekdays Mon..Sun.
    expect(gc.labels).toEqual([...HOUR_OF_DAY_LABELS]);
    expect(gc.datasets.map((d) => d.label)).toEqual([...DAY_OF_WEEK_LABELS]);

    const mon = gc.datasets.find((d) => d.label === 'Mon')!;
    const tue = gc.datasets.find((d) => d.label === 'Tue')!;
    const h09 = gc.labels.indexOf('09');
    const h10 = gc.labels.indexOf('10');
    expect(mon.values[h09]).toBe(2);
    expect(mon.values[h10]).toBe(1);
    expect(tue.values[h09]).toBe(1);
    // empty slot stays 0, not dropped
    expect(mon.values[gc.labels.indexOf('03')]).toBe(0);
    // grand total across the grid
    expect(out.value).toBe(4);
  });

  it('honors metric + aggregation (avg views per cell)', () => {
    const out = aggregateHeatmap(posts, {
      dimension: 'hour_of_day',
      breakdownDimension: 'day_of_week',
      metric: 'view_count',
      metricAgg: 'avg',
    });
    const mon = out.groupedCategorical!.datasets.find((d) => d.label === 'Mon')!;
    const h09 = out.groupedCategorical!.labels.indexOf('09');
    // avg of 100 and 300 → 200
    expect(mon.values[h09]).toBe(200);
  });

  it('ranks non-cyclical axes by total and respects topN', () => {
    const cat = [
      p({ post_id: 'a', platform: 'tiktok', sentiment: 'positive' }),
      p({ post_id: 'b', platform: 'tiktok', sentiment: 'positive' }),
      p({ post_id: 'c', platform: 'instagram', sentiment: 'negative' }),
      p({ post_id: 'd', platform: 'youtube', sentiment: 'neutral' }),
    ];
    const out = aggregateHeatmap(cat, {
      dimension: 'platform',
      breakdownDimension: 'sentiment',
      metric: 'post_count',
      topN: 2,
    });
    // top-2 platforms by total, ranked desc
    expect(out.groupedCategorical!.labels).toEqual(['tiktok', 'instagram']);
  });

  it('returns an empty grid for no posts', () => {
    const out = aggregateHeatmap([], {
      dimension: 'hour_of_day',
      breakdownDimension: 'day_of_week',
      metric: 'post_count',
    });
    expect(out.value).toBe(0);
    expect(out.groupedCategorical!.labels).toEqual([...HOUR_OF_DAY_LABELS]);
  });
});
