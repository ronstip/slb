import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { applyWidgetValueFilters } from './SocialWidgetRenderer.tsx';
import { aggregateThemes, aggregateCustom } from './dashboard-aggregations.ts';

// applyWidgetValueFilters prunes multi-valued fields down to the SELECTED values
// (value-level filtering), without dropping posts. It assumes posts were already
// row-filtered, so pruning a field to [] is acceptable. See applyWidgetFilters
// for the row-level (scope) pass.

function p(over: Partial<DashboardPost>): DashboardPost {
  return { post_id: 'x', platform: 'x', channel_handle: 'c', posted_at: '', ...over } as DashboardPost;
}

describe('applyWidgetValueFilters - multi-valued pruning', () => {
  it('prunes a themes array to the selected values', () => {
    const out = applyWidgetValueFilters([p({ post_id: 'a', themes: ['pricing', 'support'] })], { themes: ['pricing'] });
    expect(out[0].themes).toEqual(['pricing']);
  });

  it('never drops posts (a row-filtered post with no remaining value prunes to [])', () => {
    const out = applyWidgetValueFilters([p({ post_id: 'a', themes: ['support'] })], { themes: ['pricing'] });
    expect(out).toHaveLength(1);
    expect(out[0].themes).toEqual([]);
  });

  it('leaves scalar fields untouched', () => {
    const post = p({ post_id: 'a', sentiment: 'positive', themes: ['pricing', 'support'] });
    const out = applyWidgetValueFilters([post], { sentiment: ['positive'] });
    expect(out[0].sentiment).toBe('positive');
    // no themes filter → themes untouched
    expect(out[0].themes).toEqual(['pricing', 'support']);
  });

  it('prunes entities and brands too', () => {
    const out = applyWidgetValueFilters(
      [p({ entities: ['Nike', 'Adidas'], detected_brands: ['Nike', 'Puma'] })],
      { entities: ['Nike'], brands: ['Puma'] },
    );
    expect(out[0].entities).toEqual(['Nike']);
    expect(out[0].detected_brands).toEqual(['Puma']);
  });

  it('prunes an array custom field to selected values', () => {
    const out = applyWidgetValueFilters(
      [p({ custom_fields: { tags: ['x', 'y', 'z'] } })],
      { custom_fields: { tags: ['x', 'z'] } },
    );
    expect((out[0].custom_fields as Record<string, unknown>).tags).toEqual(['x', 'z']);
  });

  it('prunes list[object] elements to those matching the leaf filter', () => {
    const out = applyWidgetValueFilters(
      [p({ custom_fields: { men: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 35 }] } })],
      { custom_fields: { 'men.name': ['Alice'] } },
    );
    expect((out[0].custom_fields as Record<string, unknown>).men).toEqual([{ name: 'Alice', age: 30 }]);
  });

  it('is a no-op when no multi-valued filter is active', () => {
    const post = p({ themes: ['pricing', 'support'] });
    expect(applyWidgetValueFilters([post], { sentiment: ['positive'] })[0]).toBe(post);
    expect(applyWidgetValueFilters([post], undefined)[0]).toBe(post);
  });
});

describe('value filtering closes the multi-valued aggregation leak', () => {
  it('a themes breakdown no longer counts the unselected co-occurring theme', () => {
    // post tagged [pricing, support]; with row filtering alone, "support" would
    // still appear in a themes breakdown. After value pruning it must not.
    const posts = [
      p({ post_id: 'a', themes: ['pricing', 'support'] }),
      p({ post_id: 'b', themes: ['pricing'] }),
    ];
    const pruned = applyWidgetValueFilters(posts, { themes: ['pricing'] });
    const themes = aggregateThemes(pruned).map((t) => t.theme);
    expect(themes).toEqual(['pricing']);
    expect(themes).not.toContain('support');
  });

  it('aggregateCustom by themes counts only the selected value', () => {
    const posts = [p({ post_id: 'a', themes: ['pricing', 'support'] })];
    const pruned = applyWidgetValueFilters(posts, { themes: ['pricing'] });
    const data = aggregateCustom(pruned, { metric: 'post_count', dimension: 'themes' });
    expect(data.labels).toEqual(['pricing']);
    expect(data.values).toEqual([1]);
  });
});

describe('applyWidgetValueFilters - post_count (min group size on the widget grouping)', () => {
  // 3 instagram + 1 twitter posts.
  const mixed = () => [
    p({ post_id: 'a', platform: 'instagram' }),
    p({ post_id: 'b', platform: 'instagram' }),
    p({ post_id: 'c', platform: 'instagram' }),
    p({ post_id: 'd', platform: 'twitter' }),
  ];
  const ids = (ps: DashboardPost[]) => ps.map((x) => x.post_id).sort();
  const pc = (operator: string, value: number, value2?: number) =>
    ({ conditions: [{ field: 'post_count', operator, value, value2 }] }) as never;

  it('drops groups below the threshold using the widget grouping (greaterThan)', () => {
    // post_count carries NO dimension; the widget's grouping (platform) is supplied.
    const out = applyWidgetValueFilters(mixed(), pc('greaterThan', 2), 'platform');
    expect(ids(out)).toEqual(['a', 'b', 'c']); // twitter (count 1) removed
  });

  it('no-ops when the widget has no grouping (e.g. a number card)', () => {
    const out = applyWidgetValueFilters(mixed(), pc('greaterThan', 2), undefined);
    expect(ids(out)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('equals boundary keeps only exact-count groups', () => {
    const out = applyWidgetValueFilters(mixed(), pc('equals', 1), 'platform');
    expect(ids(out)).toEqual(['d']);
  });

  it('between bounds the group count inclusively', () => {
    const out = applyWidgetValueFilters(mixed(), pc('between', 1, 1), 'platform');
    expect(ids(out)).toEqual(['d']);
  });

  it('counts each post once per distinct value (no double-count on repeats)', () => {
    // post a repeats 'pricing'; the group count must treat it as 1, not 2.
    // counts: pricing=1 (from a, deduped), support=1 (from b). equals 1 → both survive.
    const out = applyWidgetValueFilters(
      [
        p({ post_id: 'a', themes: ['pricing', 'pricing'] }),
        p({ post_id: 'b', themes: ['support'] }),
      ],
      pc('equals', 1),
      'themes',
    );
    expect(out.map((x) => x.post_id).sort()).toEqual(['a', 'b']);
  });

  it('multi-valued grouping prunes values rather than dropping the post', () => {
    const out = applyWidgetValueFilters(
      [
        p({ post_id: 'a', themes: ['pricing', 'support'] }),
        p({ post_id: 'b', themes: ['pricing'] }),
      ],
      pc('greaterThan', 1),
      'themes',
    );
    expect(out.find((x) => x.post_id === 'a')!.themes).toEqual(['pricing']);
  });

  it('runs even when no other multi-valued filter is active (defeats early return)', () => {
    const out = applyWidgetValueFilters(mixed(), pc('greaterThan', 2), 'platform');
    expect(out).toHaveLength(3);
  });

  it('group-counts a scalar custom grouping', () => {
    const out = applyWidgetValueFilters(
      [
        p({ post_id: 'a', custom_fields: { region: 'eu' } }),
        p({ post_id: 'b', custom_fields: { region: 'eu' } }),
        p({ post_id: 'c', custom_fields: { region: 'us' } }),
      ],
      pc('greaterThan', 1),
      'custom:region',
    );
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('buckets posted_at by day when that is the grouping', () => {
    const out = applyWidgetValueFilters(
      [
        p({ post_id: 'a', posted_at: '2026-01-01T09:00:00Z' }),
        p({ post_id: 'b', posted_at: '2026-01-01T18:00:00Z' }),
        p({ post_id: 'c', posted_at: '2026-01-02T09:00:00Z' }),
      ],
      pc('greaterThan', 1),
      'posted_at',
    );
    expect(ids(out)).toEqual(['a', 'b']); // 2026-01-01 has 2, 2026-01-02 has 1
  });
});
