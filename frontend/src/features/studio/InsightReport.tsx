import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { SentimentBar } from './charts/SentimentBar.tsx';
import { VolumeChart } from './charts/VolumeChart.tsx';
import { ThemeBar } from './charts/ThemeBar.tsx';
import { ContentTypeDonut } from './charts/ContentTypeDonut.tsx';
import { EngagementMetrics } from './charts/EngagementMetrics.tsx';
import { ChannelTable } from './charts/ChannelTable.tsx';

interface InsightReportProps {
  artifact: Artifact;
}

export function InsightReport({ artifact }: InsightReportProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const data = artifact.data;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button */}
      <div className="sticky top-0 z-10 border-b border-border-default bg-bg-surface-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
      </div>

      <div className="p-4">
        {/* Header */}
        <h3 className="text-base font-semibold text-text-primary">{artifact.title}</h3>

        {/* Narrative */}
        <div className="mt-4 prose prose-sm max-w-none text-text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.narrative}
          </ReactMarkdown>
        </div>

        {/* Charts */}
        {data && (
          <div className="mt-6 flex flex-col gap-6">
            {data.quantitative.sentiment_breakdown.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Sentiment Breakdown
                </h4>
                <SentimentBar data={data.quantitative.sentiment_breakdown} />
              </div>
            )}

            {data.quantitative.volume_over_time.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Volume Over Time
                </h4>
                <VolumeChart data={data.quantitative.volume_over_time} />
              </div>
            )}

            {data.qualitative.theme_distribution.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Top Themes
                </h4>
                <ThemeBar data={data.qualitative.theme_distribution} />
              </div>
            )}

            {data.qualitative.content_type_breakdown.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Content Types
                </h4>
                <ContentTypeDonut data={data.qualitative.content_type_breakdown} />
              </div>
            )}

            {data.quantitative.engagement_summary.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Engagement Summary
                </h4>
                <EngagementMetrics data={data.quantitative.engagement_summary} />
              </div>
            )}

            {data.quantitative.channel_summary.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Top Channels
                </h4>
                <ChannelTable data={data.quantitative.channel_summary} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
