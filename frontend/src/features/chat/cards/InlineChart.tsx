import { useCallback } from 'react';
import { Expand } from 'lucide-react';
import { SocialChartWidget } from '../../studio/dashboard/SocialChartWidget.tsx';
import type { SocialChartType, WidgetData } from '../../studio/dashboard/types-social-dashboard.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { formatNumber } from '../../../lib/format.ts';

// Chart types that SocialChartWidget handles
const CHARTJS_TYPES = new Set<string>(['bar', 'line', 'pie', 'doughnut']);

/**
 * Normalize backend snake_case data to camelCase WidgetData for SocialChartWidget.
 */
function toWidgetData(raw: Record<string, unknown>): WidgetData {
  return {
    labels: raw.labels as string[] | undefined,
    values: raw.values as number[] | undefined,
    value: raw.value as number | undefined,
    timeSeries: (raw.timeSeries ?? raw.time_series) as WidgetData['timeSeries'],
    groupedTimeSeries: (raw.groupedTimeSeries ?? raw.grouped_time_series) as WidgetData['groupedTimeSeries'],
    groupedCategorical: (raw.groupedCategorical ?? raw.grouped_categorical) as WidgetData['groupedCategorical'],
  };
}

// ── Sub-components for table and number types ──────────────────────────────

function InlineTable({ data }: { data: Record<string, unknown> }) {
  const columns = (data.columns ?? []) as string[];
  const rawRows = (data.rows ?? []) as unknown[];
  if (!columns.length || !rawRows.length) return null;

  // Normalize rows: backend may send arrays or objects keyed by column name
  const rows = rawRows.map((row) =>
    Array.isArray(row) ? row : columns.map((col) => (row as Record<string, unknown>)[col]),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/20 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 text-foreground">
                  {typeof cell === 'number' ? formatNumber(cell) : String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineNumber({ data }: { data: Record<string, unknown> }) {
  const value = data.value as number | undefined;
  const label = data.label as string | undefined;
  if (value == null) return null;

  return (
    <div className="flex flex-col items-center justify-center py-6">
      <span className="text-3xl font-bold text-foreground">{formatNumber(value)}</span>
      {label && <span className="mt-1 text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface InlineChartProps {
  data: Record<string, unknown>;
}

export function InlineChart({ data }: InlineChartProps) {
  const chartType = data.chart_type as string;
  const chartData = (data.data ?? {}) as Record<string, unknown>;
  const title = data.title as string | undefined;
  const artifactId = data._artifactId as string | undefined;
  const barOrientation = data.bar_orientation as string | undefined;
  const stacked = data.stacked as boolean | undefined;
  const caption = (data.caption as string | undefined)?.trim();

  const handleOpenInStudio = useCallback(() => {
    if (!artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(artifactId);
  }, [artifactId]);

  // Render the chart content based on type
  let content: React.ReactNode;

  if (CHARTJS_TYPES.has(chartType)) {
    const widgetData = toWidgetData(chartData);
    content = (
      <div className="h-[280px]">
        <SocialChartWidget
          chartType={chartType as SocialChartType}
          data={widgetData}
          barOrientation={(barOrientation as 'horizontal' | 'vertical') ?? 'horizontal'}
          stacked={stacked ?? true}
        />
      </div>
    );
  } else if (chartType === 'table') {
    content = <InlineTable data={chartData} />;
  } else if (chartType === 'number') {
    content = <InlineNumber data={chartData} />;
  } else {
    // Unknown chart type — show nothing
    return null;
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h4 className="text-xs font-medium text-muted-foreground">{title || 'Chart'}</h4>
        {artifactId && (
          <button
            onClick={handleOpenInStudio}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <Expand className="h-3 w-3" />
            Open in Studio
          </button>
        )}
      </div>
      {/* Chart area */}
      <div className="px-4 pb-3">
        {content}
        {caption && (
          <figcaption className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Figure.</span>{' '}
            {caption}
          </figcaption>
        )}
      </div>
    </div>
  );
}
