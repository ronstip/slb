import { describe, it, expect } from 'vitest';
import { widgetContainerVisible, isHeadingOnlyMarkdown } from './widget-container.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';

function widget(extra: Partial<SocialDashboardWidget> = {}): SocialDashboardWidget {
  return {
    i: 'w', x: 0, y: 0, w: 6, h: 4,
    aggregation: 'custom',
    chartType: 'bar',
    title: 'W',
    ...extra,
  };
}

describe('isHeadingOnlyMarkdown', () => {
  it('treats empty / heading / divider content as heading-only', () => {
    expect(isHeadingOnlyMarkdown('')).toBe(true);
    expect(isHeadingOnlyMarkdown('# Title')).toBe(true);
    expect(isHeadingOnlyMarkdown('## Section\n---')).toBe(true);
  });
  it('treats body copy as not heading-only', () => {
    expect(isHeadingOnlyMarkdown('# Title\n\nSome body text.')).toBe(false);
    expect(isHeadingOnlyMarkdown('- a bullet')).toBe(false);
  });
});

describe('widgetContainerVisible', () => {
  it('defaults to visible for non-text widgets', () => {
    expect(widgetContainerVisible(widget({ aggregation: 'custom' }))).toBe(true);
    expect(widgetContainerVisible(widget({ aggregation: 'media' }))).toBe(true);
    expect(widgetContainerVisible(widget({ aggregation: 'embeds' }))).toBe(true);
  });

  it('defaults a heading-only text widget (the header) to hidden', () => {
    expect(widgetContainerVisible(widget({ aggregation: 'text', markdownContent: '# Dashboard' }))).toBe(false);
  });

  it('defaults a body text widget to visible', () => {
    expect(widgetContainerVisible(widget({ aggregation: 'text', markdownContent: '# T\n\nbody' }))).toBe(true);
  });

  it('honours an explicit showContainer override either way', () => {
    // Frame a header.
    expect(widgetContainerVisible(widget({ aggregation: 'text', markdownContent: '# T', showContainer: true }))).toBe(true);
    // Unframe a chart.
    expect(widgetContainerVisible(widget({ aggregation: 'custom', showContainer: false }))).toBe(false);
  });
});
