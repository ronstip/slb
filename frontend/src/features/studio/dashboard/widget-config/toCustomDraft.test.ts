import { describe, it, expect } from 'vitest';
import { toCustomDraft } from './SocialWidgetConfigDialog.tsx';
import type { SocialDashboardWidget } from '../types-social-dashboard.ts';

// The config dialog seeds its draft from `toCustomDraft(widget)`. Content
// widgets (text/embed/media/html) must pass through untouched - any aggregation
// it doesn't recognize is coerced to a `custom` chart, which would open the
// chart Data/Filters/Style config instead of the content editor. This guards
// the regression where an html widget opened the chart dialog.

function widget(over: Partial<SocialDashboardWidget>): SocialDashboardWidget {
  return {
    i: 'w1', x: 0, y: 0, w: 6, h: 4,
    aggregation: 'custom', chartType: 'bar', title: 't',
    ...over,
  };
}

describe('toCustomDraft', () => {
  it.each(['text', 'embeds', 'media', 'html'] as const)(
    'passes a %s content widget through without coercing aggregation',
    (aggregation) => {
      const w = widget({ aggregation, chartType: 'embed' });
      const out = toCustomDraft(w);
      expect(out.aggregation).toBe(aggregation);
    },
  );

  it('preserves htmlContent on an html widget', () => {
    const out = toCustomDraft(widget({ aggregation: 'html', chartType: 'embed', htmlContent: '<div>hi</div>' }));
    expect(out.aggregation).toBe('html');
    expect(out.htmlContent).toBe('<div>hi</div>');
  });

  it('coerces a non-content preset (e.g. sentiment) to a custom chart', () => {
    const out = toCustomDraft(widget({ aggregation: 'sentiment', chartType: 'doughnut' }));
    expect(out.aggregation).toBe('custom');
  });
});
