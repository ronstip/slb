import { useRef, useCallback } from 'react';
import { BarChart3, Download } from 'lucide-react';
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
  | 'entity_table'
  | 'value_count';

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
  value_count: Histogram,
};

const CHART_TYPE_LABELS: Partial<Record<ChartType, string>> = {
  sentiment_pie: 'Sentiment',
  sentiment_bar: 'Sentiment',
  volume_chart: 'Volume over time',
  line_chart: 'Trend',
  histogram: 'Distribution',
  theme_bar: 'Themes',
  platform_bar: 'Platform breakdown',
  content_type_donut: 'Content types',
  language_pie: 'Languages',
  engagement_metrics: 'Engagement',
  channel_table: 'Top channels',
  entity_table: 'Top entities',
  value_count: 'Distribution',
};

interface ChartCardProps {
  data: Record<string, unknown>;
}

export function ChartCard({ data }: ChartCardProps) {
  const chartType = data.chart_type as ChartType;
  const chartData = data.data as unknown[];
  const title = (data.title as string) || 'Chart';
  const artifactId = data._artifactId as string | undefined;
  const collectionName = data.collection_name as string | undefined;

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

  const subtitle = CHART_TYPE_LABELS[chartType] ?? chartType.replace(/_/g, ' ');
  const meta = collectionName || subtitle;

  return (
    <div onClick={handleView} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-accent-success/20 bg-gradient-to-b from-accent-success/5 to-background shadow-sm transition-colors hover:border-accent-success/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-success/10">
            <BarChart3 className="h-4 w-4 text-accent-success" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-[11px] text-muted-foreground">{meta}</p>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Download PNG"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline chart preview */}
      <div ref={exportRef} className="px-4 pb-3 pt-1">
        <div className="pointer-events-none max-h-[220px] overflow-hidden">
          <ChartComponent data={chartData} overrides={{}} />
        </div>
      </div>
    </div>
  );
}
