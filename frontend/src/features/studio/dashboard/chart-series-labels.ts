import type { SocialChartType, WidgetData } from './types-social-dashboard.ts';

/** Extract the labels used as series-color keys, mirroring the
 *  branching logic in SocialChartWidget so editor entries match the
 *  legend exactly.
 *
 *  - grouped time series (line)  → group names (top 10 by latest value)
 *  - grouped categorical (bar)   → dataset labels
 *  - single time series (line)   → ['Value']
 *  - categorical                 → labels (used as-is for pie/doughnut/bar)
 */
export function extractChartSeriesLabels(
  chartType: SocialChartType,
  data: WidgetData | undefined,
): string[] {
  if (!data) return [];

  if (
    chartType === 'line' &&
    data.groupedTimeSeries &&
    Object.keys(data.groupedTimeSeries).length > 0
  ) {
    return Object.entries(data.groupedTimeSeries)
      .sort(([, a], [, b]) => (b[b.length - 1]?.value ?? 0) - (a[a.length - 1]?.value ?? 0))
      .slice(0, 10)
      .map(([name]) => name);
  }

  if (chartType === 'line' && data.timeSeries && data.timeSeries.length > 0) {
    return ['Value'];
  }

  if (data.groupedCategorical) {
    if (chartType === 'bar' || chartType === 'progress-list') {
      // Grouped bar / progress-list legend = dataset labels, axis = primary
      // labels. User may want to rename either, so include both (primary axis
      // first, then dataset labels — de-duped).
      const seen = new Set<string>();
      const out: string[] = [];
      for (const l of data.groupedCategorical.labels) {
        if (l && !seen.has(l)) { seen.add(l); out.push(l); }
      }
      for (const d of data.groupedCategorical.datasets) {
        if (d.label && !seen.has(d.label)) { seen.add(d.label); out.push(d.label); }
      }
      return out;
    }
    // Pie/doughnut: SocialChartWidget flattens to "Primary – Breakdown" labels.
    const { labels: primary, datasets } = data.groupedCategorical;
    const flat: string[] = [];
    for (const ds of datasets) {
      for (let i = 0; i < primary.length; i++) {
        if (ds.values[i] > 0) flat.push(`${primary[i]} – ${ds.label}`);
      }
    }
    return flat;
  }

  if (data.labels && data.labels.length > 0) return data.labels;
  return [];
}
