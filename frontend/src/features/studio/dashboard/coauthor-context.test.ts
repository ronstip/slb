import { describe, it, expect } from 'vitest';
import {
  buildCoAuthorMessage,
  toggleAttachedWidget,
  type AttachedWidget,
} from './coauthor-context.ts';

const w = (i: string, title: string): AttachedWidget => ({ i, title });

describe('buildCoAuthorMessage', () => {
  it('returns the trimmed text unchanged when nothing is attached', () => {
    expect(buildCoAuthorMessage('  make it punchier  ', [])).toBe('make it punchier');
  });

  it('prepends a focus preamble naming a single widget id + title', () => {
    const msg = buildCoAuthorMessage('shorten this', [w('abc123', 'Sentiment over time')]);
    // user request is preserved verbatim at the end
    expect(msg.endsWith('shorten this')).toBe(true);
    // the widget id (the handle the agent passes to the tools) is present
    expect(msg).toContain('abc123');
    expect(msg).toContain('Sentiment over time');
    // singular phrasing for one widget
    expect(msg).toContain('1 widget');
    expect(msg).not.toContain('1 widgets');
  });

  it('lists every attached widget id for multiple selections', () => {
    const msg = buildCoAuthorMessage('align the colours', [
      w('id1', 'KPI: Total posts'),
      w('id2', 'Share of voice'),
    ]);
    expect(msg).toContain('id1');
    expect(msg).toContain('id2');
    expect(msg).toContain('2 widgets');
  });

  it('falls back to a placeholder for an empty title', () => {
    const msg = buildCoAuthorMessage('tweak', [w('id9', '')]);
    expect(msg).toContain('id9');
    expect(msg).toContain('Untitled');
  });

  it('lists chart category labels as exact seriesColors keys when present', () => {
    const msg = buildCoAuthorMessage('make it colorful', [
      { i: 'id1', title: 'Brands', labels: ['Adidas', 'Nike', 'Puma'] },
    ]);
    expect(msg).toContain('Adidas');
    expect(msg).toContain('Nike');
    expect(msg).toContain('seriesColors');
  });

  it('omits the category line when a widget has no labels', () => {
    const msg = buildCoAuthorMessage('rename', [{ i: 'id1', title: 'A KPI', labels: [] }]);
    expect(msg).not.toContain('categories');
    expect(msg).not.toContain('seriesColors');
  });

  it('lists renamable labels (incl. axis categories) as exact seriesLabels keys', () => {
    const msg = buildCoAuthorMessage('clean up the content type text', [
      {
        i: 'id1',
        title: 'Top Content Categories',
        labels: ['Adidas', 'Nike'], // colorable series (brands)
        renamableLabels: ['Media', 'Ugc', 'Official', 'Adidas', 'Nike'], // axis + series
      },
    ]);
    // colorable series surfaced for seriesColors
    expect(msg).toContain('seriesColors');
    // the axis content-type labels are surfaced for seriesLabels renaming
    expect(msg).toContain('seriesLabels');
    expect(msg).toContain('Ugc');
    expect(msg).toContain('Official');
  });
});

describe('toggleAttachedWidget', () => {
  it('adds a widget that is not yet attached', () => {
    expect(toggleAttachedWidget([], w('a', 'A'))).toEqual([w('a', 'A')]);
  });

  it('removes a widget that is already attached (matched by id)', () => {
    const list = [w('a', 'A'), w('b', 'B')];
    // toggling with a stale title still removes by id
    expect(toggleAttachedWidget(list, w('a', 'A (renamed)'))).toEqual([w('b', 'B')]);
  });

  it('does not mutate the input list', () => {
    const list = [w('a', 'A')];
    toggleAttachedWidget(list, w('b', 'B'));
    expect(list).toEqual([w('a', 'A')]);
  });
});
