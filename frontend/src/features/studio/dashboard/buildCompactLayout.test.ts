import { describe, expect, it } from 'vitest';
import { buildCompactLayout } from './buildCompactLayout.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

function w(overrides: Partial<SocialDashboardWidget>): SocialDashboardWidget {
  return {
    i: Math.random().toString(36).slice(2),
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    aggregation: 'custom',
    ...overrides,
  } as SocialDashboardWidget;
}

describe('buildCompactLayout - html widgets', () => {
  it('preserves a short html widget height instead of flooring it to 4 rows', () => {
    // A section divider is designed at h=2. The old code floored every html
    // widget to 4 rows, blowing a thin divider up to a 234px cell on mobile
    // (zoom-to-fit never enlarges, so the extra rows showed as dead space).
    const divider = w({ aggregation: 'html', h: 2, y: 0 });
    const layout = buildCompactLayout([divider], 2);
    expect(layout[0].h).toBe(2);
  });

  it('keeps a tall html widget at its designed height', () => {
    const tall = w({ aggregation: 'html', h: 7, y: 0 });
    const layout = buildCompactLayout([tall], 2);
    expect(layout[0].h).toBe(7);
  });

  it('floors html widgets to a 2-row minimum', () => {
    const tiny = w({ aggregation: 'html', h: 1, y: 0 });
    const layout = buildCompactLayout([tiny], 2);
    expect(layout[0].h).toBe(2);
  });

  it('still floors non-text, non-html widgets to 4 rows', () => {
    const chart = w({ aggregation: 'custom', h: 2, y: 0 });
    const layout = buildCompactLayout([chart], 2);
    expect(layout[0].h).toBe(4);
  });
});
