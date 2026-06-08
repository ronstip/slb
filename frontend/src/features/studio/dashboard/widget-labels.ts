/**
 * Compute the category LABELS a chart widget renders — the exact strings that
 * `styleOverrides.seriesColors` and `styleOverrides.seriesLabels` are keyed by
 * (SocialChartWidget's `resolveSeriesColors` / `displayLabel` look up
 * `overrides[label]` with the raw label).
 *
 * The co-author agent is otherwise blind to data-derived labels (brand names,
 * platforms, content types …), so "make it more colorful" / "clean up these
 * labels" fails: it can't build a per-key map without the keys. We attach these
 * to a pinned widget's co-author context so the agent can color and rename each
 * category.
 *
 * Two distinct key sets, because a grouped chart colors and renames different
 * things (mirrors SocialChartWidget exactly so they match by construction):
 *   - COLOR keys (`getWidgetCategoryLabels`): what `seriesColors` actually tints.
 *     For a grouped bar that's only the STACK SERIES (e.g. brands), not the
 *     x-axis categories — coloring an axis category in a stacked chart is a
 *     silent no-op.
 *   - RENAMABLE keys (`getWidgetRenamableLabels`): every raw label that passes
 *     through `displayLabel`, which `seriesLabels` can rewrite — for a grouped
 *     bar that's the x-axis categories (content types) AND the stack series.
 *
 * Value-level widget filters are deliberately NOT applied here: skipping them
 * yields a superset of labels (never fewer), which is safe.
 */
import type { DashboardPost, TopicMetric } from '../../../api/types.ts';
import type {
  SocialDashboardWidget,
  DataSource,
  SocialChartType,
  WidgetData,
} from './types-social-dashboard.ts';
import { objectFieldOf } from './types-social-dashboard.ts';
import {
  aggregateSentiment,
  aggregateEmotions,
  aggregatePlatforms,
  aggregateThemes,
  aggregateContentTypes,
  aggregateLanguages,
  aggregateCustom,
} from './dashboard-aggregations.ts';
import { aggregateObjectList } from './object-list-aggregations.ts';
import { aggregateTopicsCustom } from './topic-aggregations.ts';

/** Cap so a high-cardinality dimension (hundreds of brands) can't bloat the
 *  co-author prompt. The agent colors/renames the top categories; the tail
 *  falls back to the palette / humanised raw label. */
const MAX_LABELS = 40;

/** Chart types that ignore `seriesColors` — coloring categories does nothing,
 *  so there's no point attaching labels. */
const NON_SERIES_CHART_TYPES = new Set(['number-card', 'word-cloud', 'table']);

/** The keys `styleOverrides.seriesColors` actually tints. */
export function getWidgetCategoryLabels(
  widget: SocialDashboardWidget,
  posts: DashboardPost[],
  topics?: TopicMetric[],
): string[] {
  if (NON_SERIES_CHART_TYPES.has(widget.chartType)) return [];
  const data = widgetData(widget, posts, topics);
  if (!data) return [];
  return dedupeCap(colorKeysFromData(data, widget.chartType));
}

/** Every raw label `styleOverrides.seriesLabels` can rewrite (axis + series). */
export function getWidgetRenamableLabels(
  widget: SocialDashboardWidget,
  posts: DashboardPost[],
  topics?: TopicMetric[],
): string[] {
  // `table` renames via the same `seriesLabels` map (renameValue on cells), so
  // it IS renamable even though it's not colorable. number-card/word-cloud have
  // no per-category labels to rename.
  if (widget.chartType === 'number-card' || widget.chartType === 'word-cloud') return [];
  const data = widgetData(widget, posts, topics);
  if (!data) return [];
  return dedupeCap(labelKeysFromData(data, widget.chartType));
}

/** Build the WidgetData a chart renders from, for any aggregation. Returns null
 *  for aggregations with no category series (kpi/text/…). */
function widgetData(
  widget: SocialDashboardWidget,
  posts: DashboardPost[],
  topics?: TopicMetric[],
): WidgetData | null {
  switch (widget.aggregation) {
    case 'sentiment':
      return { labels: aggregateSentiment(posts).map((x) => x.sentiment) };
    case 'emotion':
      return { labels: aggregateEmotions(posts).map((x) => x.emotion) };
    case 'platform':
      return { labels: aggregatePlatforms(posts).map((x) => x.platform) };
    case 'themes':
      return { labels: aggregateThemes(posts).map((x) => x.theme) };
    case 'content-type':
      return { labels: aggregateContentTypes(posts).map((x) => x.content_type) };
    case 'language':
      return { labels: aggregateLanguages(posts).map((x) => x.language) };
    case 'custom': {
      const config = widget.customConfig;
      if (!config) return null;
      const objField = objectFieldOf(config);
      if (objField) return aggregateObjectList(posts, objField, config);
      const dataSource: DataSource = widget.dataSource ?? 'posts';
      return dataSource === 'topics'
        ? aggregateTopicsCustom(topics ?? [], config)
        : aggregateCustom(posts, config);
    }
    default:
      return null;
  }
}

/**
 * The strings `SocialChartWidget.resolveSeriesColors` keys by. A grouped chart's
 * colors belong to the SERIES (breakdown), not the primary axis.
 */
function colorKeysFromData(data: WidgetData, chartType: SocialChartType): string[] {
  if (data.groupedTimeSeries && Object.keys(data.groupedTimeSeries).length > 0) {
    return Object.keys(data.groupedTimeSeries);
  }
  if (data.groupedCategorical) {
    const { labels: primaryLabels, datasets } = data.groupedCategorical;
    if (chartType === 'bar') return datasets.map((ds) => ds.label);
    // pie/doughnut flatten to "Primary – Breakdown" composite slices.
    const flat: string[] = [];
    for (const ds of datasets) {
      ds.values.forEach((v, i) => {
        if (v > 0) flat.push(`${primaryLabels[i]} – ${ds.label}`);
      });
    }
    return flat;
  }
  return data.labels ?? [];
}

/**
 * Every raw label that passes through `displayLabel` (so `seriesLabels` can
 * rewrite it). For a grouped bar this is the primary AXIS categories plus the
 * SERIES labels — both are rendered via displayLabel in SocialChartWidget.
 */
function labelKeysFromData(data: WidgetData, chartType: SocialChartType): string[] {
  if (data.groupedTimeSeries && Object.keys(data.groupedTimeSeries).length > 0) {
    // x-axis is a time scale (not renamed); only series names go through displayLabel.
    return Object.keys(data.groupedTimeSeries);
  }
  if (data.groupedCategorical) {
    const { labels: primaryLabels, datasets } = data.groupedCategorical;
    if (chartType === 'bar') return [...primaryLabels, ...datasets.map((ds) => ds.label)];
    const flat: string[] = [];
    for (const ds of datasets) {
      ds.values.forEach((v, i) => {
        if (v > 0) flat.push(`${primaryLabels[i]} – ${ds.label}`);
      });
    }
    return flat;
  }
  return data.labels ?? [];
}

function dedupeCap(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (!l || seen.has(l)) continue;
    seen.add(l);
    out.push(l);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}
