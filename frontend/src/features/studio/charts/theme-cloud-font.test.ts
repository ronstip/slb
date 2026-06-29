import { describe, it, expect } from 'vitest';
import { computeCloudFontRange } from './ThemeCloud.tsx';

describe('computeCloudFontRange', () => {
  it('scales the max font to the container width (adaptive, not fixed 40px)', () => {
    const narrow = computeCloudFontRange(300);
    const wide = computeCloudFontRange(1000);
    expect(narrow.max).toBeLessThan(wide.max);
    // a small widget must not blow up to the old hardcoded 40px
    expect(narrow.max).toBeLessThan(40);
  });

  it('clamps to a sane min and max regardless of width', () => {
    const tiny = computeCloudFontRange(50);
    const huge = computeCloudFontRange(5000);
    expect(tiny.max).toBeGreaterThanOrEqual(16);
    expect(huge.max).toBeLessThanOrEqual(40);
  });

  it('keeps min proportional to (and below) max', () => {
    const { min, max } = computeCloudFontRange(400);
    expect(min).toBeLessThan(max);
    expect(min).toBeCloseTo(max * 0.18, 5);
  });

  it('applies the user scale multiplier', () => {
    const base = computeCloudFontRange(400, 1);
    const big = computeCloudFontRange(400, 1.4);
    expect(big.max).toBeCloseTo(base.max * 1.4, 5);
  });

  it('falls back to a default width before measurement (width 0)', () => {
    const { max } = computeCloudFontRange(0);
    expect(max).toBeGreaterThan(0);
  });
});
