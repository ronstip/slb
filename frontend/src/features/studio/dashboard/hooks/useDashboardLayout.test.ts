import { describe, it, expect } from 'vitest';
import { normalizeLayoutForSave } from './useDashboardLayout.ts';
import type { SocialDashboardWidget } from '../types-social-dashboard.ts';

const widget = (over: Partial<SocialDashboardWidget>): SocialDashboardWidget => ({
  i: 'w',
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  aggregation: 'text',
  chartType: 'text',
  title: 't',
  ...over,
});

describe('normalizeLayoutForSave', () => {
  // Regression: new text cards / widgets are created with `y: Infinity` as a
  // react-grid-layout append hint. Immediate saves (config-dialog add,
  // duplicate) fired before the grid repacked, and `JSON.stringify(Infinity)`
  // === 'null' tripped the backend's `y: int` validation:
  //   {"type":"int_type","loc":["body","layout",15,"y"],"input":null}
  it('packs a non-finite y to the bottom of finite widgets', () => {
    const out = normalizeLayoutForSave([
      widget({ i: 'a', y: 0, h: 4 }),
      widget({ i: 'b', y: 4, h: 3 }),
      widget({ i: 'new', y: Infinity, h: 5 }),
    ]);
    expect(out.find((w) => w.i === 'new')!.y).toBe(7);
    out.forEach((w) => expect(Number.isFinite(w.y)).toBe(true));
  });

  it('stacks multiple non-finite widgets without overlap', () => {
    const out = normalizeLayoutForSave([
      widget({ i: 'a', y: 0, h: 4 }),
      widget({ i: 'b', y: Infinity, h: 2 }),
      widget({ i: 'c', y: Infinity, h: 3 }),
    ]);
    expect(out.find((w) => w.i === 'b')!.y).toBe(4);
    expect(out.find((w) => w.i === 'c')!.y).toBe(6);
  });

  it('coerces a non-finite x to 0', () => {
    const out = normalizeLayoutForSave([
      widget({ i: 'a', x: Infinity, y: Infinity }),
    ]);
    expect(out[0].x).toBe(0);
    expect(out[0].y).toBe(0);
  });

  it('leaves an all-finite layout untouched', () => {
    const input = [widget({ i: 'a', y: 0 }), widget({ i: 'b', y: 4 })];
    expect(normalizeLayoutForSave(input)).toEqual(input);
  });
});
