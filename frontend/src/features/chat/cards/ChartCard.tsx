import { useRef, useCallback } from 'react';
import { BarChart3, Download, Eye } from 'lucide-react';
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
    <div className="mt-3 overflow-hidden rounded-2xl border border-accent-success/20 bg-gradient-to-b from-accent-success/5 to-background shadow-sm">
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

      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-success/10">
            <BarChart3 className="h-4 w-4 text-accent-success" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-[11px] text-muted-foreground">
              {chartType.replace(/_/g, ' ')} · saved to artifacts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {artifactId && (
            <button
              onClick={handleView}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="View in Studio"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Download PNG"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
