import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, BarChart3, TrendingUp, Layers, PieChart, Users, Download, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InsightData } from '../../../api/types.ts';
import { SentimentPie } from '../../studio/charts/SentimentPie.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';

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
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h5>
      </div>
      {children}
    </Card>
  );
}

export function InsightSummaryCard({ data }: InsightSummaryCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(contentRef.current, 'insight-report');
    } finally {
      setDownloading(false);
    }
  };

  const narrative = data.narrative as string | undefined;
  const insightData = data.data as InsightData | undefined;

  const hasSentiment = (insightData?.quantitative?.sentiment_breakdown?.length ?? 0) > 0;
  const hasVolume = (insightData?.quantitative?.volume_over_time?.length ?? 0) > 0;
  const hasThemes = (insightData?.qualitative?.theme_distribution?.length ?? 0) > 0;
  const hasContentTypes = (insightData?.qualitative?.content_type_breakdown?.length ?? 0) > 0;
  const hasEngagement = (insightData?.quantitative?.engagement_summary?.length ?? 0) > 0;
  const hasChannels = (insightData?.quantitative?.channel_summary?.length ?? 0) > 0;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-primary/5"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">Insight Report</h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            disabled={downloading}
            className="h-7 w-7"
            title="Download as PDF"
          >
            {downloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
          </Button>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && insightData && (
        <div ref={contentRef} className="border-t border-primary/10 px-5 pb-5">
          {/* 1. Engagement metrics — top */}
          {hasEngagement && (
            <div className="mt-4">
              <EngagementMetrics data={insightData.quantitative.engagement_summary} />
            </div>
          )}

          {/* 2. Charts — 2-column grid */}
          {(hasSentiment || hasVolume || hasThemes || hasContentTypes) && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              {hasSentiment && (
                <ChartSection icon={<PieChart className="h-3.5 w-3.5" />} title="Sentiment">
                  <SentimentPie data={insightData.quantitative.sentiment_breakdown} />
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
            </div>
          )}

          {/* 3. Channels table — full width */}
          {hasChannels && (
            <div className="mt-4">
              <ChartSection icon={<Users className="h-3.5 w-3.5" />} title="Top Channels">
                <ChannelTable data={insightData.quantitative.channel_summary} />
              </ChartSection>
            </div>
          )}

          {/* 4. Narrative — bottom */}
          {narrative && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <div className="prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
