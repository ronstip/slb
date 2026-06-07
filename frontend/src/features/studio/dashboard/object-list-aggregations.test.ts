import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import type { CustomChartConfig, CustomTableConfig } from './types-social-dashboard.ts';
import { aggregateObjectList, aggregateObjectTable } from './object-list-aggregations.ts';

// Two posts, three `men` elements total. Element-as-unit: count is 3 (NOT 2 =
// post count), so a post with multiple objects never collapses to the post.
function fixture(): DashboardPost[] {
  return [
    { custom_fields: { men: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 35 }] } },
    { custom_fields: { men: [{ name: 'Alice', age: 50 }] } },
  ] as unknown as DashboardPost[];
}

const cfg = (over: Partial<CustomChartConfig>): CustomChartConfig => ({
  metric: 'customobj:men.__count',
  ...over,
});

describe('aggregateObjectList', () => {
  it('counts elements, not posts (element-as-unit)', () => {
    const out = aggregateObjectList(fixture(), 'men', cfg({ metric: 'customobj:men.__count' }));
    expect(out.value).toBe(3);
  });

  it('avg of a numeric leaf over all elements', () => {
    const out = aggregateObjectList(
      fixture(),
      'men',
      cfg({ metric: 'customobj:men.age', metricAgg: 'avg' }),
    );
    expect(out.value).toBeCloseTo((30 + 35 + 50) / 3, 5); // 38.33…
  });

  it('min / max of a numeric leaf', () => {
    const min = aggregateObjectList(fixture(), 'men', cfg({ metric: 'customobj:men.age', metricAgg: 'min' }));
    const max = aggregateObjectList(fixture(), 'men', cfg({ metric: 'customobj:men.age', metricAgg: 'max' }));
    expect(min.value).toBe(30);
    expect(max.value).toBe(50);
  });

  it('distribution of a categorical leaf', () => {
    const out = aggregateObjectList(
      fixture(),
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.__count' }),
    );
    expect(out.labels).toEqual(['Alice', 'Bob']);
    expect(out.values).toEqual([2, 1]);
  });

  it('group by categorical leaf, avg a numeric leaf', () => {
    const out = aggregateObjectList(
      fixture(),
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.age', metricAgg: 'avg' }),
    );
    // Alice ages [30, 50] → 40 ; Bob [35] → 35. Sorted by value desc.
    expect(out.labels).toEqual(['Alice', 'Bob']);
    expect(out.values).toEqual([40, 35]);
  });

  it('returns zero count for a field absent from all posts', () => {
    const out = aggregateObjectList(fixture(), 'women', cfg({ metric: 'customobj:women.__count' }));
    expect(out.value).toBe(0);
  });
});

// Posts carrying engagement metrics + identity, for inherited / distinct-post
// metrics. Ron appears in post A (1000 views) and post B (500); Donald only in A.
function engagementFixture(): DashboardPost[] {
  return [
    {
      post_id: 'A', view_count: 1000, like_count: 10, comment_count: 2, share_count: 1,
      custom_fields: { men: [{ name: 'Ron' }, { name: 'Donald' }] },
    },
    {
      post_id: 'B', view_count: 500, like_count: 5, comment_count: 0, share_count: 0,
      custom_fields: { men: [{ name: 'Ron' }] },
    },
  ] as unknown as DashboardPost[];
}

describe('aggregateObjectList - inherited post metrics', () => {
  it('each element inherits its parent post metric (sum across posts)', () => {
    const out = aggregateObjectList(
      engagementFixture(),
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.post.view_count', metricAgg: 'sum' }),
    );
    const byName = Object.fromEntries((out.labels ?? []).map((l, i) => [l, out.values![i]]));
    expect(byName.Ron).toBe(1500);   // post A (1000) + post B (500)
    expect(byName.Donald).toBe(1000); // post A only
  });

  it('co-occurring elements in the same post each get the full value', () => {
    const posts = [
      { post_id: 'A', view_count: 1000, custom_fields: { men: [{ name: 'Ron' }, { name: 'Ron' }] } },
    ] as unknown as DashboardPost[];
    const out = aggregateObjectList(
      posts,
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.post.view_count', metricAgg: 'sum' }),
    );
    expect(out.values).toEqual([2000]); // two Ron elements × 1000
  });

  it('engagement_total inherited = likes + comments + shares per element', () => {
    const out = aggregateObjectList(
      engagementFixture(),
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.post.engagement_total', metricAgg: 'sum' }),
    );
    const byName = Object.fromEntries((out.labels ?? []).map((l, i) => [l, out.values![i]]));
    // post A engagement = 10+2+1 = 13 ; post B = 5+0+0 = 5
    expect(byName.Ron).toBe(18);    // A(13) + B(5)
    expect(byName.Donald).toBe(13); // A only
  });
});

describe('aggregateObjectList - distinct posts', () => {
  it('counts distinct parent posts per group, deduped per post', () => {
    const out = aggregateObjectList(
      engagementFixture(),
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.__posts' }),
    );
    const byName = Object.fromEntries((out.labels ?? []).map((l, i) => [l, out.values![i]]));
    expect(byName.Ron).toBe(2);    // posts A and B
    expect(byName.Donald).toBe(1); // post A only
  });

  it('two elements in one post = one distinct post', () => {
    const posts = [
      { post_id: 'A', view_count: 1000, custom_fields: { men: [{ name: 'Ron' }, { name: 'Ron' }] } },
    ] as unknown as DashboardPost[];
    const out = aggregateObjectList(
      posts,
      'men',
      cfg({ dimension: 'custom:men.name', metric: 'customobj:men.__posts' }),
    );
    expect(out.values).toEqual([1]);
  });

  it('no dimension → distinct posts containing any element', () => {
    const out = aggregateObjectList(
      engagementFixture(),
      'men',
      cfg({ metric: 'customobj:men.__posts' }),
    );
    expect(out.value).toBe(2); // posts A and B both have men
  });
});

describe('aggregateObjectTable - inherited / distinct columns', () => {
  it('inherited metric column resolves per element; distinct-posts dedups', () => {
    const rows = aggregateObjectTable(engagementFixture(), 'men', {
      mode: 'group',
      columns: [
        { id: 'name', kind: 'dimension', dimension: 'custom:men.name' },
        { id: 'views', kind: 'metric', metric: 'customobj:men.post.view_count', agg: 'sum' },
        { id: 'posts', kind: 'metric', metric: 'customobj:men.__posts' },
      ],
      sortBy: 'views',
      sortDir: 'desc',
      rowLimit: 25,
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name as string, r]));
    expect(byName.Ron.views).toBe(1500);
    expect(byName.Ron.posts).toBe(2);
    expect(byName.Donald.views).toBe(1000);
    expect(byName.Donald.posts).toBe(1);
  });
});

describe('aggregateObjectTable - element-as-unit grouped table', () => {
  const tableConfig: CustomTableConfig = {
    mode: 'group',
    columns: [
      { id: 'name', kind: 'dimension', dimension: 'custom:men.name' },
      { id: 'cnt', kind: 'metric', metric: 'customobj:men.__count' },
      { id: 'avgage', kind: 'metric', metric: 'customobj:men.age', agg: 'avg' },
    ],
    sortBy: 'cnt',
    sortDir: 'desc',
    rowLimit: 25,
  };

  it('rows = leaf groups; count + avg per group, no post double-count', () => {
    const rows = aggregateObjectTable(fixture(), 'men', tableConfig);
    const byName = Object.fromEntries(rows.map((r) => [r.name as string, r]));
    expect(rows.length).toBe(2);
    expect(byName.Alice.cnt).toBe(2);      // Alice appears in 2 elements
    expect(byName.Alice.avgage).toBe(40);  // (30+50)/2
    expect(byName.Bob.cnt).toBe(1);
    expect(byName.Bob.avgage).toBe(35);
    // element total across rows = 3, never collapsed to 2 posts
    expect((byName.Alice.cnt as number) + (byName.Bob.cnt as number)).toBe(3);
  });

  it('no dimension columns → single aggregate row', () => {
    const rows = aggregateObjectTable(fixture(), 'men', {
      ...tableConfig,
      columns: [{ id: 'cnt', kind: 'metric', metric: 'customobj:men.__count' }],
    });
    expect(rows.length).toBe(1);
    expect(rows[0].cnt).toBe(3);
  });
});
