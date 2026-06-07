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
