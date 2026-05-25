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

  it('keeps consecutive KPIs side-by-side when cols are wide enough', () => {
    const widgets: SocialDashboardWidget[] = [
      makeWidget('kpi-a', 0, 0, 'number-card'),
      makeWidget('kpi-b', 4, 0, 'number-card'),
      makeWidget('kpi-c', 8, 0, 'number-card'),
    ];
    const layout = buildCompactLayout(widgets, 12);
    const ys = layout.map((l) => l.y);
    expect(new Set(ys).size).toBe(1);
    layout.forEach((l) => expect(l.w).toBe(4));
  });

  it('wraps a KPI row across extra rows when cols are too narrow for ≥2-wide cards', () => {
    // cols=4 leaves room for 2 cards per row at min-width 2.
    const widgets: SocialDashboardWidget[] = [
      makeWidget('kpi-a', 0, 0, 'number-card'),
      makeWidget('kpi-b', 4, 0, 'number-card'),
      makeWidget('kpi-c', 8, 0, 'number-card'),
    ];
    const layout = buildCompactLayout(widgets, 4);
    const byId = Object.fromEntries(layout.map((l) => [l.i, l]));
    expect(byId['kpi-a']).toMatchObject({ x: 0, y: 0, w: 2 });
    expect(byId['kpi-b']).toMatchObject({ x: 2, y: 0, w: 2 });
    expect(byId['kpi-c']).toMatchObject({ x: 0, y: 2, w: 2 });
  });

  it('stacks each KPI full-width at the narrowest breakpoint', () => {
    const widgets: SocialDashboardWidget[] = [
      makeWidget('kpi-a', 0, 0, 'number-card'),
      makeWidget('kpi-b', 4, 0, 'number-card'),
      makeWidget('kpi-c', 8, 0, 'number-card'),
    ];
    const layout = buildCompactLayout(widgets, 2);
    layout.forEach((l) => expect(l.w).toBe(2));
    const ys = layout.map((l) => l.y).sort((a, b) => a - b);
    expect(ys).toEqual([0, 2, 4]);
  });

  it('places a following widget below the last wrapped KPI row, not overlapping', () => {
    const widgets: SocialDashboardWidget[] = [
      makeWidget('kpi-a', 0, 0, 'number-card'),
      makeWidget('kpi-b', 4, 0, 'number-card'),
      makeWidget('kpi-c', 8, 0, 'number-card'),
      makeWidget('chart', 0, 5, 'bar'),
    ];
    const layout = buildCompactLayout(widgets, 4);
    const chart = layout.find((l) => l.i === 'chart')!;
    const maxKpiBottom = Math.max(
      ...layout.filter((l) => l.i.startsWith('kpi-')).map((l) => l.y + 2),
    );
    expect(chart.y).toBeGreaterThanOrEqual(maxKpiBottom);
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
