import { useRef, useState, useCallback } from 'react';
import { ArrowLeft, Check, Copy, Download, Palette, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { SocialChartWidget } from './dashboard/SocialChartWidget.tsx';
import type { SocialChartType, WidgetData } from './dashboard/types-social-dashboard.ts';
import { copyChartToClipboard, downloadChartPng } from '../../lib/chart-export.ts';
import { formatNumber } from '../../lib/format.ts';
import { UnderlyingDataDialog, type UnderlyingDataFallback } from './UnderlyingDataDialog.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet.tsx';
import { ChartStyleEditor } from './dashboard/widget-config/ChartStyleEditor.tsx';
import { extractChartSeriesLabels } from './dashboard/chart-series-labels.ts';
import { useChartStyleSave } from './dashboard/use-chart-style-save.ts';

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

function StudioTable({ data }: { data: Record<string, unknown> }) {
  const columns = (data.columns ?? []) as string[];
  const rows = (data.rows ?? []) as unknown[][];
  if (!columns.length || !rows.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/30 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground">
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

function StudioNumber({ data }: { data: Record<string, unknown> }) {
  const value = data.value as number | undefined;
  const label = data.label as string | undefined;
  if (value == null) return null;

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <span className="text-5xl font-bold text-foreground">{formatNumber(value)}</span>
      {label && <span className="mt-2 text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface ChartArtifactViewProps {
  artifact: Extract<Artifact, { type: 'chart' }>;
}

export function ChartArtifactView({ artifact }: ChartArtifactViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const exportRef = useRef<HTMLDivElement>(null);

  const chartType = artifact.chartType;
  const chartData = artifact.data;
  const styleOverrides = artifact.styleOverrides ?? {};
  const handleStyleChange = useChartStyleSave(artifact.id);

  const handleDownload = useCallback(async () => {
    if (!exportRef.current) return;
    await downloadChartPng(exportRef.current, artifact.title.replace(/\s+/g, '_').toLowerCase());
  }, [artifact.title]);

  const handleCopy = useCallback(async () => {
    if (!exportRef.current) return;
    try {
      await copyChartToClipboard(exportRef.current);
      setCopyState('copied');
    } catch (err) {
      console.error('Copy chart failed', err);
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 1500);
  }, []);

  // Render the chart content based on type
  let content: React.ReactNode;

  if (CHARTJS_TYPES.has(chartType)) {
    const widgetData = toWidgetData(chartData);
    content = (
      <div className="h-[400px]">
        <SocialChartWidget
          chartType={chartType as SocialChartType}
          data={widgetData}
          accent={artifact.styleOverrides?.accent}
          seriesColorOverrides={artifact.styleOverrides?.seriesColors}
          seriesLabelOverrides={artifact.styleOverrides?.seriesLabels}
          barOrientation={(artifact.barOrientation as 'horizontal' | 'vertical') ?? 'horizontal'}
          stacked={artifact.stacked ?? true}
          xAxis={artifact.styleOverrides?.xAxis}
          yAxis={artifact.styleOverrides?.yAxis}
        />
      </div>
    );
  } else if (chartType === 'table') {
    content = <StudioTable data={chartData} />;
  } else if (chartType === 'number') {
    content = <StudioNumber data={chartData} />;
  } else {
    content = (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        Unsupported chart type: {chartType}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
        <div className="flex items-center gap-1.5">
          {(artifact.collectionIds?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowUnderlyingData(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Table2 className="h-3.5 w-3.5" />
              Data
            </button>
          )}
          {CHARTJS_TYPES.has(chartType) && (
            <button
              onClick={() => setShowStyleEditor(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Palette className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          {CHARTJS_TYPES.has(chartType) && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              {copyState === 'copied' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : copyState === 'error' ? (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy failed
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy image
                </>
              )}
            </button>
          )}
          {CHARTJS_TYPES.has(chartType) && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              Download PNG
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={exportRef} className="px-4 pb-2 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {artifact.title}
          </p>
          {content}
        </div>
      </div>

      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        fallback={artifact.collectionIds?.length ? {
          collectionIds: artifact.collectionIds,
          createdAt: artifact.createdAt.toISOString(),
          sourceSql: artifact.sourceSql,
        } as UnderlyingDataFallback : undefined}
        onClose={() => setShowUnderlyingData(false)}
      />

      <Sheet open={showStyleEditor} onOpenChange={setShowStyleEditor}>
        <SheetContent side="right" className="w-[360px] sm:max-w-[360px]">
          <SheetHeader>
            <SheetTitle className="text-sm">Edit chart style</SheetTitle>
            <SheetDescription className="text-xs">
              Changes save automatically.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <ChartStyleEditor
              chartType={chartType as SocialChartType}
              seriesLabels={extractChartSeriesLabels(
                chartType as SocialChartType,
                toWidgetData(chartData),
              )}
              value={styleOverrides}
              onChange={handleStyleChange}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
