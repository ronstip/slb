import { useState, useRef } from 'react';
import { ArrowLeft, PieChart, TrendingUp, Layers, Users, Download, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { Button } from '../../components/ui/button.tsx';
import { SentimentPie } from './charts/SentimentPie.tsx';
import { VolumeChart } from './charts/VolumeChart.tsx';
import { ThemeBar } from './charts/ThemeBar.tsx';
import { ContentTypeDonut } from './charts/ContentTypeDonut.tsx';
import { EngagementMetrics } from './charts/EngagementMetrics.tsx';
import { ChannelTable } from './charts/ChannelTable.tsx';
import { downloadReportPdf } from '../../lib/download-pdf.ts';

interface InsightReportProps {
  artifact: Artifact;
}

export function InsightReport({ artifact }: InsightReportProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const data = artifact.data;
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(contentRef.current, artifact.title || 'insight-report');
    } finally {
      setDownloading(false);
    }
  };

  const hasSentiment = (data?.quantitative?.sentiment_breakdown?.length ?? 0) > 0;
  const hasVolume = (data?.quantitative?.volume_over_time?.length ?? 0) > 0;
  const hasThemes = (data?.qualitative?.theme_distribution?.length ?? 0) > 0;
  const hasContentTypes = (data?.qualitative?.content_type_breakdown?.length ?? 0) > 0;
  const hasEngagement = (data?.quantitative?.engagement_summary?.length ?? 0) > 0;
  const hasChannels = (data?.quantitative?.channel_summary?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={collapseReport}
          className="h-auto gap-1.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          className="h-auto gap-1.5 px-2.5 py-1 text-xs"
        >
          {downloading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Download className="h-3.5 w-3.5" />}
          {downloading ? 'Exporting...' : 'Download PDF'}
        </Button>
      </div>

      <div ref={contentRef} className="p-4">
        {/* Header */}
        <h3 className="text-base font-semibold text-foreground">{artifact.title}</h3>

        {data && (
          <div className="mt-4 flex flex-col gap-4">
            {/* 1. Engagement metrics — top */}
            {hasEngagement && (
              <EngagementMetrics data={data.quantitative.engagement_summary} />
            )}

            {/* 2. Charts — 2-column grid */}
            {(hasSentiment || hasVolume || hasThemes || hasContentTypes) && (
              <div className="grid grid-cols-2 gap-4">
                {hasSentiment && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <PieChart className="h-3.5 w-3.5 text-primary" />
                      Sentiment
                    </h4>
                    <SentimentPie data={data.quantitative.sentiment_breakdown} />
                  </div>
                )}
                {hasVolume && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5 text-primary" />
                      Volume Over Time
                    </h4>
                    <VolumeChart data={data.quantitative.volume_over_time} />
                  </div>
                )}
                {hasThemes && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Layers className="h-3.5 w-3.5 text-primary" />
                      Top Themes
                    </h4>
                    <ThemeBar data={data.qualitative.theme_distribution} />
                  </div>
                )}
                {hasContentTypes && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <PieChart className="h-3.5 w-3.5 text-primary" />
                      Content Types
                    </h4>
                    <ContentTypeDonut data={data.qualitative.content_type_breakdown} />
                  </div>
                )}
              </div>
            )}

            {/* 3. Channels table — full width */}
            {hasChannels && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Top Channels
                </h4>
                <ChannelTable data={data.quantitative.channel_summary} />
              </div>
            )}
          </div>
        )}

        {/* 4. Narrative — bottom */}
        {artifact.narrative && (
          <div className="mt-6 prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {artifact.narrative}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
