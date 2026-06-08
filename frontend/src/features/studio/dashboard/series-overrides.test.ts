import { describe, it, expect } from 'vitest';
import { normalizeLabelKey, makeOverrideResolver } from './series-overrides.ts';

describe('normalizeLabelKey', () => {
  it('lowercases, trims, and collapses separators', () => {
    expect(normalizeLabelKey('  Fan_Vlog ')).toBe('fan vlog');
    expect(normalizeLabelKey('Official-Ad')).toBe('official ad');
    expect(normalizeLabelKey('match   highlights')).toBe('match highlights');
  });
});

describe('makeOverrideResolver', () => {
  it('resolves an exact key', () => {
    const r = makeOverrideResolver({ 'fan vlog': '#f00' });
    expect(r('fan vlog')).toBe('#f00');
  });

  it('resolves a near-miss key differing only by case/separator (the real bug)', () => {
    // Data label is "fan vlog"; the agent keyed the override "Fan Vlog".
    const r = makeOverrideResolver({ 'Fan Vlog': '#f00', 'Official_Ad': '#0f0' });
    expect(r('fan vlog')).toBe('#f00');
    expect(r('official ad')).toBe('#0f0');
  });

  it('returns undefined when nothing matches', () => {
    const r = makeOverrideResolver({ 'fan vlog': '#f00' });
    expect(r('brand challenge')).toBeUndefined();
  });

  it('prefers an exact match over a normalized collision', () => {
    const r = makeOverrideResolver({ 'fan vlog': '#exact', 'Fan_Vlog': '#norm' });
    expect(r('fan vlog')).toBe('#exact');
  });

  it('ignores empty override values', () => {
    const r = makeOverrideResolver({ 'fan vlog': '' });
    expect(r('fan vlog')).toBeUndefined();
  });

  it('is a no-op resolver when overrides is undefined', () => {
    const r = makeOverrideResolver(undefined);
    expect(r('anything')).toBeUndefined();
  });
});
