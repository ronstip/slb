import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import { applyWidgetFilters } from './SocialWidgetRenderer.tsx';

// Three posts; `men` is a list[object]. Object-leaf filters keep/drop the WHOLE
// post (post-level), they never split elements.
function posts(): DashboardPost[] {
  return [
    { post_id: 'a', custom_fields: { men: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 35 }] } },
    { post_id: 'b', custom_fields: { men: [{ name: 'Carol', age: 41 }] } },
    { post_id: 'c', custom_fields: { men: [] } },
  ] as unknown as DashboardPost[];
}

const ids = (ps: DashboardPost[]) => ps.map((p) => p.post_id);

describe('applyWidgetFilters - list[object] leaf filtering', () => {
  it('keeps a post when ANY element matches the leaf value', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.name': ['Alice'] } });
    expect(ids(out)).toEqual(['a']); // only post a has an Alice
  });

  it('matches across distinct elements of the same post', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.name': ['Bob'] } });
    expect(ids(out)).toEqual(['a']); // Bob is the 2nd element of post a
  });

  it('OR within a leaf selection', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.name': ['Alice', 'Carol'] } });
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('numeric leaf filters by stringified value', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.age': ['41'] } });
    expect(ids(out)).toEqual(['b']);
  });

  it('drops posts with an empty / missing object array', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.name': ['Alice'] } });
    expect(ids(out)).not.toContain('c');
  });

  it('empty selection is a no-op', () => {
    const out = applyWidgetFilters(posts(), { custom_fields: { 'men.name': [] } });
    expect(ids(out)).toEqual(['a', 'b', 'c']);
  });
});

// Post-level condition eval (categorical / custom / numeric) via applyWidgetFilters.
function cposts(): DashboardPost[] {
  return [
    { post_id: 'a', sentiment: 'positive', themes: ['pricing', 'support'], content: 'love it',
      custom_fields: { score: 8, note: 'great value', tier: 'gold', men: [{ name: 'Alice' }] } },
    { post_id: 'b', sentiment: 'negative', themes: ['bugs'], content: 'broken',
      custom_fields: { score: 2, note: 'meh', tier: 'silver', men: [{ name: 'Bob' }] } },
  ] as unknown as DashboardPost[];
}
const cids = (ps: DashboardPost[]) => ps.map((p) => p.post_id);

describe('applyWidgetFilters - categorical & custom conditions', () => {
  it('isAnyOf on a scalar built-in', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'sentiment', operator: 'isAnyOf', value: '', values: ['positive'] }],
    });
    expect(cids(out)).toEqual(['a']);
  });

  it('isNoneOf on a scalar built-in', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'sentiment', operator: 'isNoneOf', value: '', values: ['positive'] }],
    });
    expect(cids(out)).toEqual(['b']);
  });

  it('isAnyOf on a multi-valued built-in (theme intersection)', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'themes', operator: 'isAnyOf', value: '', values: ['support'] }],
    });
    expect(cids(out)).toEqual(['a']);
  });

  it('numeric custom field with greaterThan', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'custom:score', operator: 'greaterThan', value: 5 }],
    });
    expect(cids(out)).toEqual(['a']);
  });

  it('str custom field with contains', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'custom:note', operator: 'contains', value: 'value' }],
    });
    expect(cids(out)).toEqual(['a']);
  });

  it('isAnyOf on an object leaf', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'custom:men.name', operator: 'isAnyOf', value: '', values: ['Bob'] }],
    });
    expect(cids(out)).toEqual(['b']);
  });

  it('empty values is a no-op', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'sentiment', operator: 'isAnyOf', value: '', values: [] }],
    });
    expect(cids(out)).toEqual(['a', 'b']);
  });

  it('a post_count condition never drops posts at the post level', () => {
    const out = applyWidgetFilters(cposts(), {
      conditions: [{ field: 'post_count', operator: 'greaterThan', value: 100 }],
    });
    expect(cids(out)).toEqual(['a', 'b']);
  });
});
