import { useCallback } from 'react';
import { BarChart3 } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';

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
  const title = (data.title as string) || 'Chart';
  const artifactId = data._artifactId as string | undefined;
  const collectionName = data.collection_name as string | undefined;

  const handleView = useCallback(() => {
    if (!artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(artifactId);
  }, [artifactId]);

  const subtitle = CHART_TYPE_LABELS[chartType] ?? chartType?.replace(/_/g, ' ');
  const meta = collectionName || subtitle;

  return (
    <div onClick={handleView} className="cursor-pointer overflow-hidden rounded-2xl border border-accent-success/20 bg-gradient-to-b from-accent-success/5 to-background shadow-sm transition-colors hover:border-accent-success/40">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-success/10">
            <BarChart3 className="h-4 w-4 text-accent-success" />
          </div>
          <div className="flex flex-col min-w-0">
            <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
            <p className="text-[11px] text-muted-foreground truncate">{meta}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
