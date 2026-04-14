import type { SocialDashboardWidget } from './types-social-dashboard.ts';

let _idCounter = 0;
function uid(): string {
  return `w${++_idCounter}`;
}

/**
 * Returns the default dashboard layout — mirrors the existing DashboardContent.tsx
 * section-by-section layout, converted to react-grid-layout coordinates.
 * Grid: 12 columns, 48px rowHeight, 8px margins.
 */
export function getDefaultLayout(): SocialDashboardWidget[] {
  _idCounter = 0;
  return [
    // ── Row 1: KPI cards (y=0, h=2) ──────────────────────────────────
    {
      i: uid(),
      x: 0, y: 0, w: 3, h: 2,
      aggregation: 'kpi',
      kpiIndex: 0,
      chartType: 'number-card',
      title: 'Total Posts',
    },
    {
      i: uid(),
      x: 3, y: 0, w: 3, h: 2,
      aggregation: 'kpi',
      kpiIndex: 1,
      chartType: 'number-card',
      title: 'Total Views',
    },
    {
      i: uid(),
      x: 6, y: 0, w: 3, h: 2,
      aggregation: 'kpi',
      kpiIndex: 2,
      chartType: 'number-card',
      title: 'Total Engagement',
    },
    {
      i: uid(),
      x: 9, y: 0, w: 3, h: 2,
      aggregation: 'kpi',
      kpiIndex: 3,
      chartType: 'number-card',
      title: 'Engagement Rate',
    },

    // ── Row 2: Distribution (y=2, h=6) ──────────────────────────────
    {
      i: uid(),
      x: 0, y: 2, w: 4, h: 6,
      aggregation: 'sentiment',
      chartType: 'doughnut',
      title: 'Sentiment',
    },
    {
      i: uid(),
      x: 4, y: 2, w: 4, h: 6,
      aggregation: 'emotion',
      chartType: 'bar',
      title: 'Emotions',
    },
    {
      i: uid(),
      x: 8, y: 2, w: 4, h: 6,
      aggregation: 'platform',
      chartType: 'bar',
      title: 'Platform',
    },

    // ── Row 3: Trends (y=8, h=6) ─────────────────────────────────────
    {
      i: uid(),
      x: 0, y: 8, w: 12, h: 6,
      aggregation: 'volume',
      chartType: 'line',
      title: 'Volume Over Time',
    },

    // ── Row 4: Sentiment over time (y=14, h=6) ───────────────────────
    {
      i: uid(),
      x: 0, y: 14, w: 12, h: 6,
      aggregation: 'sentiment-over-time',
      chartType: 'line',
      title: 'Sentiment Over Time',
    },

    // ── Row 5: Topics (y=20, h=7) ────────────────────────────────────
    {
      i: uid(),
      x: 0, y: 20, w: 6, h: 7,
      aggregation: 'theme-cloud',
      chartType: 'word-cloud',
      title: 'Theme Cloud',
    },
    {
      i: uid(),
      x: 6, y: 20, w: 6, h: 7,
      aggregation: 'themes',
      chartType: 'bar',
      title: 'Top Themes',
    },

    // ── Row 6: Deep dive (y=27, h=8) ─────────────────────────────────
    {
      i: uid(),
      x: 0, y: 27, w: 6, h: 8,
      aggregation: 'entities',
      chartType: 'table',
      title: 'Top Entities',
    },
    {
      i: uid(),
      x: 6, y: 27, w: 6, h: 8,
      aggregation: 'channels',
      chartType: 'table',
      title: 'Top Channels',
    },

    // ── Row 7: Content breakdown (y=35, h=6) ─────────────────────────
    {
      i: uid(),
      x: 0, y: 35, w: 6, h: 6,
      aggregation: 'content-type',
      chartType: 'doughnut',
      title: 'Content Type',
    },
    {
      i: uid(),
      x: 6, y: 35, w: 6, h: 6,
      aggregation: 'language',
      chartType: 'pie',
      title: 'Language',
    },

    // ── Row 8: Engagement rate (y=41, h=6) ───────────────────────────
    {
      i: uid(),
      x: 0, y: 41, w: 12, h: 6,
      aggregation: 'engagement-rate',
      chartType: 'line',
      title: 'Engagement Rate Over Time',
    },

  ];
}

/**
 * Compact explorer layout for task data explorer.
 * Row 1: 4 KPI cards
 * Row 2: Sentiment + Platform + Themes (3 charts)
 * Row 3: Posts table (hero, fills lower half)
 */
export function getExplorerDefaultLayout(): SocialDashboardWidget[] {
  _idCounter = 0;
  return [
    // ── Row 1: KPI cards (y=0, h=2) ──────────────────────────────────
    { i: uid(), x: 0, y: 0, w: 3, h: 2, aggregation: 'kpi', kpiIndex: 0, chartType: 'number-card', title: 'Total Posts' },
    { i: uid(), x: 3, y: 0, w: 3, h: 2, aggregation: 'kpi', kpiIndex: 1, chartType: 'number-card', title: 'Total Views' },
    { i: uid(), x: 6, y: 0, w: 3, h: 2, aggregation: 'kpi', kpiIndex: 2, chartType: 'number-card', title: 'Total Engagement' },
    { i: uid(), x: 9, y: 0, w: 3, h: 2, aggregation: 'kpi', kpiIndex: 3, chartType: 'number-card', title: 'Engagement Rate' },

    // ── Row 2: Charts (y=2, h=5) ─────────────────────────────────────
    { i: uid(), x: 0, y: 2, w: 4, h: 5, aggregation: 'sentiment', chartType: 'doughnut', title: 'Sentiment' },
    { i: uid(), x: 4, y: 2, w: 4, h: 5, aggregation: 'platform', chartType: 'bar', title: 'Platform' },
    { i: uid(), x: 8, y: 2, w: 4, h: 5, aggregation: 'themes', chartType: 'bar', title: 'Top Themes' },

    // ── Row 3: Posts table — hero (y=7, h=14) ────────────────────────
    { i: uid(), x: 0, y: 7, w: 12, h: 14, aggregation: 'posts', chartType: 'data-table', title: 'Posts' },
  ];
}

/**
 * Minimal starter layout for newly created explorer layouts.
 * Single small widget so the canvas feels empty — user builds from scratch in edit mode.
 */
export function getNewLayoutStarterWidgets(): SocialDashboardWidget[] {
  _idCounter = 100;
  return [
    { i: uid(), x: 0, y: 0, w: 3, h: 2, aggregation: 'kpi', kpiIndex: 0, chartType: 'number-card', title: 'Total Posts' },
  ];
}
