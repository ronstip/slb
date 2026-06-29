import { describe, it, expect } from 'vitest';
import { buildCloudWordModels } from './ThemeCloud.tsx';
import type { CloudWord } from '../dashboard/dashboard-aggregations.ts';

const RANGE = { min: 12, max: 40 };

describe('buildCloudWordModels', () => {
  it('maps the largest word to the max font / heavy weight and the smallest to the min font', () => {
    const data: CloudWord[] = [
      { text: 'big', value: 100 },
      { text: 'mid', value: 50 },
      { text: 'small', value: 0 },
    ];
    const [big, , small] = buildCloudWordModels(data, RANGE);
    expect(big.normalized).toBe(1);
    expect(big.font).toBeCloseTo(RANGE.max, 5);
    expect(big.weight).toBe(700);
    expect(small.normalized).toBe(0);
    expect(small.font).toBeCloseTo(RANGE.min, 5);
    expect(small.weight).toBe(500);
  });

  it('preserves the input order and length', () => {
    const data: CloudWord[] = [
      { text: 'a', value: 9 },
      { text: 'b', value: 4 },
      { text: 'c', value: 1 },
    ];
    const models = buildCloudWordModels(data, RANGE);
    expect(models.map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('produces a deterministic rotation in {0, 90} keyed by the word text', () => {
    const data: CloudWord[] = [{ text: 'star wars', value: 5 }, { text: 'lucas', value: 4 }];
    const a = buildCloudWordModels(data, RANGE);
    const b = buildCloudWordModels(data, RANGE);
    for (let i = 0; i < a.length; i++) {
      expect([0, 90]).toContain(a[i].rotate);
      expect(a[i].rotate).toBe(b[i].rotate); // stable across calls -> no layout jitter
    }
  });

  it('keeps the dominant words horizontal for readability', () => {
    const data: CloudWord[] = Array.from({ length: 20 }, (_, i) => ({
      text: `w${i}`,
      value: 100 - i,
    }));
    const models = buildCloudWordModels(data, RANGE);
    // top word (normalized = 1) must never be rotated
    expect(models[0].rotate).toBe(0);
  });

  it('does not divide by zero when every word has the same value', () => {
    const data: CloudWord[] = [
      { text: 'a', value: 7 },
      { text: 'b', value: 7 },
    ];
    const models = buildCloudWordModels(data, RANGE);
    expect(models.every((m) => Number.isFinite(m.font))).toBe(true);
  });
});
