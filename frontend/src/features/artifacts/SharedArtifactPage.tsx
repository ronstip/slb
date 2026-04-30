import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  getPublicArtifact,
  type SharedArtifactResponse,
} from '../../api/endpoints/artifacts.ts';
import { SocialChartWidget } from '../studio/dashboard/SocialChartWidget.tsx';
import type {
  SocialChartType,
  WidgetData,
} from '../studio/dashboard/types-social-dashboard.ts';
import { PostDataTable } from '../studio/PostDataTable.tsx';
import { ARTIFACT_STYLES } from './artifact-utils.ts';
import { formatNumber } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import type { DataExportRow } from '../../api/types.ts';

const CHARTJS_TYPES = new Set<string>(['bar', 'line', 'pie', 'doughnut']);

function formatSharedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

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

export function SharedArtifactPage() {
  const { token } = useParams<{ token: string }>();

  // The app shell sets a global body min-width: 1280px for desktop-only
  // surfaces. The public share page is a viral landing surface that must
  // render on phones — drop the constraint while mounted, restore on unmount.
  useEffect(() => {
    const prev = document.body.style.minWidth;
    document.body.style.minWidth = '0';
    return () => { document.body.style.minWidth = prev; };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-artifact', token],
    queryFn: () => getPublicArtifact(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const style = data ? ARTIFACT_STYLES[data.meta.type] ?? ARTIFACT_STYLES.chart : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Logo size="sm" />
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={() => window.open('/', '_blank')}
            className="shrink-0"
          >
            Create your own
          </Button>
        </div>
      </header>

      {isLoading && (
        <div className="mx-auto max-w-6xl px-6 py-8 space-y-4 w-full">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {(error || (!isLoading && !data)) && (
        <div className="flex flex-1 flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Artifact not available</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This share link may have been revoked or has expired.
          </p>
        </div>
      )}

      {!isLoading && !error && data && style && (
        <>
          <div className="border-b border-border bg-card shrink-0">
            <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', style.bg)}>
                  <style.icon className={cn('h-4.5 w-4.5', style.color)} />
                </div>
                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-xl font-semibold text-foreground">
                    {data.meta.title}
                  </h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {style.label}
                    {data.meta.created_at && ` · Shared ${formatSharedDate(data.meta.created_at)}`}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
            <SharedArtifactBody data={data} token={token!} />
          </main>
        </>
      )}
    </div>
  );
}

function SharedArtifactBody({
  data,
  token,
}: {
  data: SharedArtifactResponse;
  token: string;
}) {
  switch (data.meta.type) {
    case 'chart':
      return <SharedChart payload={data.payload} />;
    case 'data_export':
      return <SharedDataExport payload={data.payload} />;
    case 'presentation':
      return <SharedPresentationDownload payload={data.payload} token={token} />;
    default:
      return (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          This artifact type can't be displayed publicly.
        </div>
      );
  }
}

function SharedChart({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  const chartType = (payload.chart_type as string) ?? 'bar';
  const chartData = (payload.data ?? {}) as Record<string, unknown>;
  const stacked = (payload.stacked as boolean | undefined) ?? true;
  const barOrientation = ((payload.bar_orientation ?? payload.barOrientation) as
    | 'horizontal'
    | 'vertical'
    | undefined) ?? 'horizontal';
  const caption = (payload.caption as string | undefined)?.trim();

  let content: React.ReactNode;
  if (CHARTJS_TYPES.has(chartType)) {
    content = (
      <div className="h-[400px]">
        <SocialChartWidget
          chartType={chartType as SocialChartType}
          data={toWidgetData(chartData)}
          barOrientation={barOrientation}
          stacked={stacked}
        />
      </div>
    );
  } else if (chartType === 'table') {
    const columns = (chartData.columns ?? []) as string[];
    const rows = (chartData.rows ?? []) as unknown[][];
    content = columns.length && rows.length ? (
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
    ) : null;
  } else if (chartType === 'number') {
    const value = chartData.value as number | undefined;
    const label = chartData.label as string | undefined;
    content = value == null ? null : (
      <div className="flex flex-col items-center justify-center py-12">
        <span className="text-5xl font-bold text-foreground">{formatNumber(value)}</span>
        {label && <span className="mt-2 text-sm text-muted-foreground">{label}</span>}
      </div>
    );
  } else {
    content = (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        Unsupported chart type: {chartType}
      </div>
    );
  }

  return (
    <figure className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      {content}
      {caption && (
        <figcaption className="mt-6 max-w-3xl border-t border-border/60 pt-4 text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Figure.</span>{' '}
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function SharedDataExport({ payload }: { payload: Record<string, unknown> }) {
  const rows = (payload.rows ?? []) as DataExportRow[];
  const rowCount = (payload.row_count ?? rows.length) as number;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PostDataTable rows={rows} rowCount={rowCount} />
    </div>
  );
}

function SharedPresentationDownload({
  payload,
  token,
}: {
  payload: Record<string, unknown>;
  token: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slideCount = (payload.slide_count as number | undefined) ?? 0;

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${API_BASE}/artifacts/shares/public/${token}/presentation.pptx`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'presentation.pptx';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10">
        <Download className="h-7 w-7 text-orange-500" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-foreground">
        {slideCount > 0
          ? `${slideCount} slide${slideCount === 1 ? '' : 's'} ready`
          : 'Presentation ready'}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Download the PowerPoint file to view, edit, or present this deck.
      </p>
      <Button className="mt-6 gap-2" onClick={handleDownload} disabled={downloading}>
        <Download className="h-4 w-4" />
        {downloading ? 'Preparing…' : 'Download .pptx'}
      </Button>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}
