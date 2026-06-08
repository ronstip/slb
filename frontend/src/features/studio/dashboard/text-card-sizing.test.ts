import { describe, it, expect } from 'vitest';
import { shouldAutoSizeWidget } from './text-card-sizing.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

function textWidget(over: Partial<SocialDashboardWidget> = {}): SocialDashboardWidget {
  return {
    i: 'w1',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    aggregation: 'text',
    chartType: 'table',
    title: 'Text',
    markdownContent: '# Hi',
    ...over,
  };
}

describe('shouldAutoSizeWidget', () => {
  it('auto-sizes a fresh card (manualHeight undefined)', () => {
    expect(shouldAutoSizeWidget(textWidget())).toBe(true);
  });

  it('auto-sizes when manualHeight is explicitly false', () => {
    expect(shouldAutoSizeWidget(textWidget({ manualHeight: false }))).toBe(true);
  });

  it('stops auto-sizing once the user has manually resized', () => {
    expect(shouldAutoSizeWidget(textWidget({ manualHeight: true }))).toBe(false);
  });
});
