import { describe, it, expect } from 'vitest';
import { resolveSparklineEnabled, toCumulativeSeries } from './sparkline-visibility.ts';

describe('resolveSparklineEnabled', () => {
  it('falls back to size default when no explicit toggle', () => {
    expect(resolveSparklineEnabled('small', undefined)).toBe(false);
    expect(resolveSparklineEnabled('medium', undefined)).toBe(true);
    expect(resolveSparklineEnabled('big', undefined)).toBe(true);
  });

  it('explicit toggle overrides size default', () => {
    // turn OFF on a card that defaults on
    expect(resolveSparklineEnabled('big', false)).toBe(false);
    expect(resolveSparklineEnabled('medium', false)).toBe(false);
    // turn ON on a small card that defaults off
    expect(resolveSparklineEnabled('small', true)).toBe(true);
  });
});

describe('toCumulativeSeries', () => {
  it('returns a running total', () => {
    expect(toCumulativeSeries([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
  });

  it('handles empty and single-element arrays', () => {
    expect(toCumulativeSeries([])).toEqual([]);
    expect(toCumulativeSeries([5])).toEqual([5]);
  });

  it('does not mutate the input', () => {
    const input = [2, 2];
    toCumulativeSeries(input);
    expect(input).toEqual([2, 2]);
  });
});
