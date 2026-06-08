import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';
import { getWidgetCategoryLabels, getWidgetRenamableLabels } from './widget-labels.ts';

const post = (p: Partial<DashboardPost>): DashboardPost => p as DashboardPost;

const widget = (w: Partial<SocialDashboardWidget>): SocialDashboardWidget =>
  ({ i: 'x', x: 0, y: 0, w: 4, h: 8, chartType: 'pie', title: 't', ...w }) as SocialDashboardWidget;

describe('getWidgetCategoryLabels', () => {
  it('returns the exact raw sentiment labels a sentiment chart renders', () => {
    const posts = [
      post({ sentiment: 'positive' }),
      post({ sentiment: 'positive' }),
      post({ sentiment: 'negative' }),
    ];
    const labels = getWidgetCategoryLabels(widget({ aggregation: 'sentiment' }), posts);
    expect(labels).toContain('positive');
    expect(labels).toContain('negative');
  });

  it('returns the custom-dimension category values (the brand case)', () => {
    const posts = [
      post({ detected_brands: ['Adidas', 'Nike'] }),
      post({ detected_brands: ['Adidas'] }),
      post({ detected_brands: ['Puma'] }),
    ];
    const w = widget({
      aggregation: 'custom',
      customConfig: { metric: 'post_count', dimension: 'brands' },
    });
    const labels = getWidgetCategoryLabels(w, posts);
    expect(labels).toEqual(expect.arrayContaining(['Adidas', 'Nike', 'Puma']));
  });

  it('grouped/stacked bar: returns the breakdown (series) labels, not the x-axis labels', () => {
    // The screenshot case: x-axis = channel_type (Media/Ugc), stacked by brand.
    // seriesColors keys the chart by the *dataset* (brand) labels, so those are
    // the strings the co-author must color — NOT the primary axis labels.
    const posts = [
      post({ channel_type: 'Media', detected_brands: ['Adidas', 'Nike'] }),
      post({ channel_type: 'Ugc', detected_brands: ['Puma'] }),
      post({ channel_type: 'Media', detected_brands: ['Adidas'] }),
    ];
    const w = widget({
      chartType: 'bar',
      aggregation: 'custom',
      customConfig: {
        metric: 'post_count',
        dimension: 'channel_type',
        breakdownDimension: 'brands',
      },
    });
    const labels = getWidgetCategoryLabels(w, posts);
    expect(labels).toEqual(expect.arrayContaining(['Adidas', 'Nike', 'Puma']));
    expect(labels).not.toContain('Media');
    expect(labels).not.toContain('Ugc');
  });

  it('grouped line (time series + breakdown): returns the breakdown series names', () => {
    const posts = [
      post({ posted_at: '2026-01-01', detected_brands: ['Adidas'] }),
      post({ posted_at: '2026-01-02', detected_brands: ['Nike'] }),
    ];
    const w = widget({
      chartType: 'line',
      aggregation: 'custom',
      customConfig: {
        metric: 'post_count',
        dimension: 'posted_at',
        breakdownDimension: 'brands',
      },
    });
    const labels = getWidgetCategoryLabels(w, posts);
    expect(labels).toEqual(expect.arrayContaining(['Adidas', 'Nike']));
  });

  it('grouped categorical as pie: returns composite "primary – breakdown" slice labels', () => {
    const posts = [
      post({ channel_type: 'Media', detected_brands: ['Adidas'] }),
      post({ channel_type: 'Ugc', detected_brands: ['Nike'] }),
    ];
    const w = widget({
      chartType: 'pie',
      aggregation: 'custom',
      customConfig: {
        metric: 'post_count',
        dimension: 'channel_type',
        breakdownDimension: 'brands',
      },
    });
    const labels = getWidgetCategoryLabels(w, posts);
    // pie flattens grouped data into "Primary – Breakdown" slices (en-dash).
    expect(labels).toContain('Media – Adidas');
    expect(labels).toContain('Ugc – Nike');
  });

  it('dedupes and drops empties', () => {
    const posts = [post({ platform: 'twitter' }), post({ platform: 'twitter' }), post({ platform: '' })];
    const labels = getWidgetCategoryLabels(widget({ aggregation: 'platform' }), posts);
    expect(labels.filter((l) => l === 'twitter')).toHaveLength(1);
    expect(labels).not.toContain('');
  });

  it('returns [] for widgets without a colorable category series (kpi/text)', () => {
    expect(getWidgetCategoryLabels(widget({ aggregation: 'kpi' }), [])).toEqual([]);
    expect(getWidgetCategoryLabels(widget({ aggregation: 'text' }), [])).toEqual([]);
  });
});

describe('getWidgetRenamableLabels', () => {
  it('grouped/stacked bar: includes BOTH the x-axis categories and the series labels', () => {
    // seriesLabels renames any rendered raw label - axis categories (content
    // types) AND stack series (brands). The color-key set only covers brands;
    // renaming must also reach the content-type axis labels.
    const posts = [
      post({ channel_type: 'Media', detected_brands: ['Adidas', 'Nike'] }),
      post({ channel_type: 'Ugc', detected_brands: ['Puma'] }),
    ];
    const w = widget({
      chartType: 'bar',
      aggregation: 'custom',
      customConfig: {
        metric: 'post_count',
        dimension: 'channel_type',
        breakdownDimension: 'brands',
      },
    });
    const labels = getWidgetRenamableLabels(w, posts);
    expect(labels).toEqual(expect.arrayContaining(['Media', 'Ugc', 'Adidas', 'Nike', 'Puma']));
  });

  it('single-dimension chart: renamable == colorable labels', () => {
    const posts = [post({ platform: 'twitter' }), post({ platform: 'tiktok' })];
    const w = widget({ aggregation: 'platform' });
    expect(getWidgetRenamableLabels(w, posts).sort()).toEqual(
      getWidgetCategoryLabels(w, posts).sort(),
    );
  });
});
