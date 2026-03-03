import { useRef, useCallback } from 'react';
import { BarChart3, Download, ExternalLink } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { SentimentPie } from '../../studio/charts/SentimentPie.tsx';
import { SentimentBar } from '../../studio/charts/SentimentBar.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { LineChart } from '../../studio/charts/LineChart.tsx';
import { Histogram } from '../../studio/charts/Histogram.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { PlatformBar } from '../../studio/charts/PlatformBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../../studio/charts/LanguagePie.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';
import { EntityTable } from '../../studio/charts/EntityTable.tsx';
import { downloadChartPng } from '../../../lib/chart-export.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import type { ChartOverrides } from '../../studio/charts/chart-overrides.ts';

type ChartType =
  | 'sentiment_pie'
  | 'sentiment_bar'
  | 'volume_chart'
  | 'line_chart'
  | 'histogram'
  | 'theme_bar'
  | 'platform_bar'
  | 'content_type_donut'
  | 'language_pie'
  | 'engagement_metrics'
  | 'channel_table'
  | 'entity_table';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHART_COMPONENTS: Record<ChartType, React.ComponentType<{ data: any; overrides?: ChartOverrides }>> = {
  sentiment_pie: SentimentPie,
  sentiment_bar: SentimentBar,
  volume_chart: VolumeChart,
  line_chart: LineChart,
  histogram: Histogram,
  theme_bar: ThemeBar,
  platform_bar: PlatformBar,
  content_type_donut: ContentTypeDonut,
  language_pie: LanguagePie,
  engagement_metrics: EngagementMetrics,
  channel_table: ChannelTable,
  entity_table: EntityTable,
};

interface ChartCardProps {
  data: Record<string, unknown>;
}

export function ChartCard({ data }: ChartCardProps) {
  const chartType = data.chart_type as ChartType;
  const chartData = data.data as unknown[];
  const title = (data.title as string) || 'Chart';
  const artifactId = data._artifactId as string | undefined;

  // Hidden ref used solely for PNG export
  const exportRef = useRef<HTMLDivElement>(null);

  const ChartComponent = CHART_COMPONENTS[chartType];
  if (!ChartComponent || !chartData) return null;

  const handleView = useCallback(() => {
    if (!artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(artifactId);
  }, [artifactId]);

  const handleDownload = useCallback(async () => {
    if (!exportRef.current) return;
    await downloadChartPng(exportRef.current, title.replace(/\s+/g, '_').toLowerCase());
  }, [title]);

  return (
    <Card className="mt-3 overflow-hidden rounded-md">
      {/* Off-screen render of the chart used only for PNG export */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: 0, width: '500px', pointerEvents: 'none' }}
      >
        <div ref={exportRef} style={{ padding: '16px', background: 'white' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666' }}>
            {title}
          </p>
          <ChartComponent data={chartData} overrides={{}} />
        </div>
      </div>

      {/* Compact artifact card */}
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-success/10">
          <BarChart3 className="h-5 w-5 text-accent-success" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground/70">
            {chartType.replace(/_/g, ' ')} · saved to artifacts
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {artifactId && (
            <button
              onClick={handleView}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
        </div>
      </div>
    </Card>
  );
}
