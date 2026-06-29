import { describe, it, expect } from 'vitest';
import {
  widgetContainerVisible,
  isHeadingOnlyMarkdown,
  frameContentPadding,
  frameHeaderPaddingX,
  cardScrollWrapperClass,
  autoSizeBottomPadPx,
} from './widget-container.ts';
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

// "Container off" must mean true full-bleed: content flush to the cell edge so
// frameless widgets line up with each other and don't show phantom padding.

describe('frameContentPadding', () => {
  it('keeps the card inset when the container is visible', () => {
    expect(frameContentPadding(false)).toBe('px-[15px] pb-[15px] pt-[2px]');
  });
  it('is full-bleed when the container is hidden', () => {
    expect(frameContentPadding(true)).toBe('p-0');
  });
  it('lets an explicit override win regardless of container state', () => {
    expect(frameContentPadding(false, 'p-0')).toBe('p-0');
    expect(frameContentPadding(true, 'px-2')).toBe('px-2');
  });
});

describe('frameHeaderPaddingX', () => {
  it('insets the header when boxed, flush when frameless', () => {
    expect(frameHeaderPaddingX(false)).toBe('px-[15px]');
    expect(frameHeaderPaddingX(true)).toBe('px-0');
  });
});

describe('cardScrollWrapperClass', () => {
  it('reserves a scrollbar gutter + padding when boxed', () => {
    const cls = cardScrollWrapperClass(true);
    expect(cls).toContain('[scrollbar-gutter:stable]');
    expect(cls).toContain('px-5 py-5');
  });
  it('drops the gutter (no phantom right strip) when frameless', () => {
    const cls = cardScrollWrapperClass(false);
    expect(cls).not.toContain('scrollbar-gutter');
    expect(cls).not.toContain('px-5');
    expect(cls).toContain('overflow-y-auto');
  });
});

describe('autoSizeBottomPadPx', () => {
  it('reserves room for the card padding when boxed', () => {
    expect(autoSizeBottomPadPx(true)).toBe(60);
  });
  it('adds only a tiny buffer when frameless so it does not round up a row', () => {
    expect(autoSizeBottomPadPx(false)).toBe(8);
  });
});
