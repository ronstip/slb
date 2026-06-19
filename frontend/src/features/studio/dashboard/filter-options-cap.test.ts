import { describe, it, expect } from 'vitest';
import { visibleFilterOptions, MAX_VISIBLE_FILTER_OPTIONS } from './DashboardFilterBar.tsx';

const opts = (n: number) => Array.from({ length: n }, (_, i) => `opt-${i}`);

describe('visibleFilterOptions', () => {
  it('returns the full list untouched for non-searchable dims (low cardinality)', () => {
    const all = opts(5000);
    const { visible, hidden } = visibleFilterOptions(all, false);
    expect(visible).toBe(all); // same reference - no slicing work
    expect(hidden).toBe(0);
  });

  it('does not cap a searchable list at or under the limit', () => {
    const all = opts(MAX_VISIBLE_FILTER_OPTIONS);
    const { visible, hidden } = visibleFilterOptions(all, true);
    expect(visible).toBe(all);
    expect(hidden).toBe(0);
  });

  it('caps a high-cardinality searchable list and reports the remainder', () => {
    const all = opts(7362); // real entities cardinality from the slow dashboard
    const { visible, hidden } = visibleFilterOptions(all, true);
    expect(visible).toHaveLength(MAX_VISIBLE_FILTER_OPTIONS);
    expect(hidden).toBe(7362 - MAX_VISIBLE_FILTER_OPTIONS);
    // keeps order (alphabetical upstream) - first N of the filtered list
    expect(visible[0]).toBe('opt-0');
    expect(visible.at(-1)).toBe(`opt-${MAX_VISIBLE_FILTER_OPTIONS - 1}`);
  });

  it('an empty list yields no rows and nothing hidden', () => {
    const { visible, hidden } = visibleFilterOptions([], true);
    expect(visible).toEqual([]);
    expect(hidden).toBe(0);
  });
});
