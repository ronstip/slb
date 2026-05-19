import { describe, it, expect } from 'vitest';
import { buildCompactLayout } from './buildCompactLayout.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

function makeWidget(
  i: string,
  x: number,
  y: number,
  chartType: SocialDashboardWidget['chartType'],
  extra: Partial<SocialDashboardWidget> = {},
): SocialDashboardWidget {
  return {
    i,
    x,
    y,
    w: 6,
    h: 4,
    aggregation: chartType === 'number-card' ? 'kpi' : 'custom',
    chartType,
    title: i,
    ...extra,
  };
}

describe('buildCompactLayout', () => {
  it('preserves designed visual order when KPIs sit between charts', () => {
    // Design: chart, then KPI row, then another chart.
    // Old behaviour bucketed all KPIs to row 0; new behaviour keeps order.
    const widgets: SocialDashboardWidget[] = [
      makeWidget('chart-top', 0, 0, 'bar'),
      makeWidget('kpi-a', 0, 5, 'number-card'),
      makeWidget('kpi-b', 6, 5, 'number-card'),
      makeWidget('chart-bottom', 0, 8, 'line'),
    ];
    const layout = buildCompactLayout(widgets, 4);
    const order = layout
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((l) => l.i);
    expect(order).toEqual(['chart-top', 'kpi-a', 'kpi-b', 'chart-bottom']);
  });

  it('keeps consecutive KPIs sharing a designed row side-by-side', () => {
    const widgets: SocialDashboardWidget[] = [
      makeWidget('kpi-a', 0, 0, 'number-card'),
      makeWidget('kpi-b', 4, 0, 'number-card'),
      makeWidget('kpi-c', 8, 0, 'number-card'),
    ];
    const layout = buildCompactLayout(widgets, 4);
    const ys = layout.map((l) => l.y);
    expect(new Set(ys).size).toBe(1);
  });

  it('stacks non-KPI widgets full-width in designed order', () => {
    const widgets: SocialDashboardWidget[] = [
      makeWidget('b', 6, 0, 'bar'),
      makeWidget('a', 0, 0, 'line'),
    ];
    // Designed order by (y, x): 'a' (x=0), then 'b' (x=6)
    const layout = buildCompactLayout(widgets, 4);
    const sorted = layout.slice().sort((p, q) => p.y - q.y);
    expect(sorted.map((l) => l.i)).toEqual(['a', 'b']);
    sorted.forEach((l) => expect(l.w).toBe(4));
  });
});
