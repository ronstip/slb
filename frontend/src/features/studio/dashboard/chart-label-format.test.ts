import { describe, it, expect } from 'vitest';
import { resolveLabelDisplay, formatPct, composeLabel } from './chart-label-format.ts';

describe('resolveLabelDisplay', () => {
  it('defaults pie/doughnut to percent, others to absolute', () => {
    expect(resolveLabelDisplay('pie', undefined)).toBe('pct');
    expect(resolveLabelDisplay('doughnut', undefined)).toBe('pct');
    expect(resolveLabelDisplay('bar', undefined)).toBe('abs');
    expect(resolveLabelDisplay('line', undefined)).toBe('abs');
  });

  it('honors an explicit choice over the default', () => {
    expect(resolveLabelDisplay('pie', 'abs')).toBe('abs');
    expect(resolveLabelDisplay('bar', 'pct')).toBe('pct');
    expect(resolveLabelDisplay('line', 'abs_pct')).toBe('abs_pct');
  });
});

describe('formatPct', () => {
  it('uses 1dp under 10%, none at or above', () => {
    expect(formatPct(5, 100)).toBe('5.0%');
    expect(formatPct(25, 100)).toBe('25%');
    expect(formatPct(1, 8)).toBe('13%'); // 12.5 → 13 (>=10%, rounded, no decimals)
  });

  it('guards a zero or invalid total', () => {
    expect(formatPct(5, 0)).toBe('0%');
    expect(formatPct(5, Number.NaN)).toBe('0%');
  });
});

describe('composeLabel', () => {
  it('returns the absolute text for abs', () => {
    expect(composeLabel('1.2K', 1200, 4800, 'abs')).toBe('1.2K');
  });

  it('returns only the percent for pct', () => {
    expect(composeLabel('1.2K', 1200, 4800, 'pct')).toBe('25%');
  });

  it('returns number and percent for abs_pct', () => {
    expect(composeLabel('1.2K', 1200, 4800, 'abs_pct')).toBe('1.2K (25%)');
  });
});
