import { describe, it, expect } from 'vitest';
import { formatNumber } from './format.ts';

describe('formatNumber', () => {
  it('formats thousands / millions / billions with one decimal', () => {
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(1_234_567)).toBe('1.2M');
    expect(formatNumber(2_500_000_000)).toBe('2.5B');
  });

  it('renders whole sub-1000 numbers without decimals', () => {
    expect(formatNumber(372)).toBe('372');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
  });

  it('rounds long fractional sub-1000 values to one decimal (no raw floats)', () => {
    // Regression: avg/virality metrics used to leak raw floats like
    // "467.90909090909093" into table cells.
    expect(formatNumber(467.90909090909093)).toBe('467.9');
    expect(formatNumber(817.55)).toBe('817.6');
    expect(formatNumber(588.9)).toBe('588.9');
  });

  it('drops a trailing .0 after rounding', () => {
    expect(formatNumber(42.04)).toBe('42');
  });

  it('handles null / undefined', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
  });
});
