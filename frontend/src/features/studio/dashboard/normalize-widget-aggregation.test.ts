import { describe, it, expect } from 'vitest';
import { normalizeWidgetAggregation } from './types-social-dashboard.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

function w(partial: Partial<SocialDashboardWidget>): SocialDashboardWidget {
  return {
    i: 'x', aggregation: 'kpi', chartType: 'number-card',
    x: 0, y: 0, w: 3, h: 2,
    ...partial,
  } as SocialDashboardWidget;
}

describe('normalizeWidgetAggregation', () => {
  it('coerces a kpi number-card carrying a custom metric to aggregation:custom', () => {
    // The story bug: agent sets customConfig.metric but leaves aggregation:"kpi",
    // so the canonical KpiWidget ignores it and renders Total Posts. After
    // coercion the CustomWidget path renders the intended metric + title.
    const out = normalizeWidgetAggregation(
      w({ aggregation: 'kpi', chartType: 'number-card', customConfig: { metric: 'view_count' }, title: 'Artan Views' }),
    );
    expect(out.aggregation).toBe('custom');
    expect(out.customConfig?.metric).toBe('view_count');
    expect(out.kpiIndex).toBeUndefined();
  });

  it('leaves a plain canonical kpi card untouched', () => {
    const card = w({ aggregation: 'kpi', chartType: 'number-card', kpiIndex: 1 });
    const out = normalizeWidgetAggregation(card);
    expect(out.aggregation).toBe('kpi');
    expect(out.kpiIndex).toBe(1);
  });

  it('does not coerce a non-number-card kpi-ish widget', () => {
    const out = normalizeWidgetAggregation(
      w({ aggregation: 'sentiment', chartType: 'pie', customConfig: { metric: 'post_count' } }),
    );
    expect(out.aggregation).toBe('sentiment');
  });

  it('is idempotent on an already-custom number-card', () => {
    const card = w({ aggregation: 'custom', chartType: 'number-card', customConfig: { metric: 'view_count' } });
    const out = normalizeWidgetAggregation(card);
    expect(out.aggregation).toBe('custom');
    expect(out.customConfig?.metric).toBe('view_count');
  });
});
