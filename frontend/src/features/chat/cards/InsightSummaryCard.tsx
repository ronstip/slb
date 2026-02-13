import { useState } from 'react';
import { ChevronDown, ChevronUp, BarChart3, TrendingUp, Layers, PieChart, Heart, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InsightData } from '../../../api/types.ts';
import { SentimentBar } from '../../studio/charts/SentimentBar.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';

interface InsightSummaryCardProps {
  data: Record<string, unknown>;
}

interface ChartSectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function ChartSection({ icon, title, children }: ChartSectionProps) {
  return (
    <div className="rounded-xl border border-border-default/40 bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h5 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</h5>
      </div>
      {children}
    </div>
  );
}

export function InsightSummaryCard({ data }: InsightSummaryCardProps) {
  const [expanded, setExpanded] = useState(true);

  const narrative = data.narrative as string | undefined;
  const insightData = data.data as InsightData | undefined;

  const hasSentiment = (insightData?.quantitative?.sentiment_breakdown?.length ?? 0) > 0;
  const hasVolume = (insightData?.quantitative?.volume_over_time?.length ?? 0) > 0;
  const hasThemes = (insightData?.qualitative?.theme_distribution?.length ?? 0) > 0;
  const hasContentTypes = (insightData?.qualitative?.content_type_breakdown?.length ?? 0) > 0;
  const hasEngagement = (insightData?.quantitative?.engagement_summary?.length ?? 0) > 0;
  const hasChannels = (insightData?.quantitative?.channel_summary?.length ?? 0) > 0;
  const hasCharts = hasSentiment || hasVolume || hasThemes || hasContentTypes || hasEngagement || hasChannels;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-b from-accent-subtle/40 to-bg-surface shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-accent-subtle/30"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
            <BarChart3 className="h-4 w-4 text-accent" />
          </div>
          <h4 className="text-sm font-semibold text-text-primary">Insight Report</h4>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-text-tertiary" />
          : <ChevronDown className="h-4 w-4 text-text-tertiary" />}
      </button>

      {expanded && (
        <div className="border-t border-accent/10 px-5 pb-5">
          {/* Narrative */}
          {narrative && (
            <div className="mt-4 prose prose-sm max-w-none text-text-secondary prose-headings:text-text-primary prose-strong:text-text-primary prose-p:leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
            </div>
          )}

          {/* Charts */}
          {hasCharts && insightData && (
            <div className="mt-5 flex flex-col gap-4">
              {hasSentiment && (
                <ChartSection icon={<BarChart3 className="h-3.5 w-3.5" />} title="Sentiment">
                  <SentimentBar data={insightData.quantitative.sentiment_breakdown} />
                </ChartSection>
              )}
              {hasVolume && (
                <ChartSection icon={<TrendingUp className="h-3.5 w-3.5" />} title="Volume Over Time">
                  <VolumeChart data={insightData.quantitative.volume_over_time} />
                </ChartSection>
              )}
              {hasThemes && (
                <ChartSection icon={<Layers className="h-3.5 w-3.5" />} title="Top Themes">
                  <ThemeBar data={insightData.qualitative.theme_distribution} />
                </ChartSection>
              )}
              {hasContentTypes && (
                <ChartSection icon={<PieChart className="h-3.5 w-3.5" />} title="Content Types">
                  <ContentTypeDonut data={insightData.qualitative.content_type_breakdown} />
                </ChartSection>
              )}
              {hasEngagement && (
                <ChartSection icon={<Heart className="h-3.5 w-3.5" />} title="Engagement">
                  <EngagementMetrics data={insightData.quantitative.engagement_summary} />
                </ChartSection>
              )}
              {hasChannels && (
                <ChartSection icon={<Users className="h-3.5 w-3.5" />} title="Top Channels">
                  <ChannelTable data={insightData.quantitative.channel_summary} />
                </ChartSection>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
