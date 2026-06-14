import { describe, it, expect } from 'vitest';
import { visibleWidgets } from './visible-widgets.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

const w = (i: string, hidden?: boolean): SocialDashboardWidget =>
  ({
    i,
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    aggregation: 'kpi',
    chartType: 'number-card',
    title: i,
    ...(hidden === undefined ? {} : { hidden }),
  }) as SocialDashboardWidget;

describe('visibleWidgets', () => {
  it('returns every widget in edit mode, including hidden ones', () => {
    const widgets = [w('a'), w('b', true), w('c', false)];
    expect(visibleWidgets(widgets, true)).toEqual(widgets);
  });

  it('filters hidden widgets in view mode', () => {
    const widgets = [w('a'), w('b', true), w('c')];
    expect(visibleWidgets(widgets, false).map((x) => x.i)).toEqual(['a', 'c']);
  });

  it('keeps legacy widgets without the field and explicit false', () => {
    const widgets = [w('a'), w('b', false)];
    expect(visibleWidgets(widgets, false)).toEqual(widgets);
  });

  it('returns the same array reference when nothing is hidden in view mode', () => {
    // Avoids needless re-renders downstream of useMemo consumers.
    const widgets = [w('a'), w('b')];
    expect(visibleWidgets(widgets, false)).toBe(widgets);
  });
});
