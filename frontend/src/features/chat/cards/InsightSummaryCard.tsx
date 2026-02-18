import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, BarChart3, TrendingUp, Layers, PieChart, Users, Download, Loader2, Globe, Hash, LayoutGrid } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InsightData } from '../../../api/types.ts';
import { SentimentPie } from '../../studio/charts/SentimentPie.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';
import { LanguagePie } from '../../studio/charts/LanguagePie.tsx';
import { EntityTable } from '../../studio/charts/EntityTable.tsx';
import { PlatformBar } from '../../studio/charts/PlatformBar.tsx';
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
    <Card className="rounded-md p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h5 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h5>
      </div>
      {children}
    </Card>
  );
}

function formatDateRange(dateFrom: string | null | undefined, dateTo: string | null | undefined): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
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
  const collectionName = data.collection_name as string | undefined;
  const dateFrom = data.date_from as string | null | undefined;
  const dateTo = data.date_to as string | null | undefined;
  const dateRange = formatDateRange(dateFrom, dateTo);

  const hasSentiment = (insightData?.quantitative?.sentiment_breakdown?.length ?? 0) > 0;
  const hasVolume = (insightData?.quantitative?.volume_over_time?.length ?? 0) > 0;
  const hasThemes = (insightData?.qualitative?.theme_distribution?.length ?? 0) > 0;
  const hasContentTypes = (insightData?.qualitative?.content_type_breakdown?.length ?? 0) > 0;
  const hasEngagement = (insightData?.quantitative?.engagement_summary?.length ?? 0) > 0;
  const hasChannels = (insightData?.quantitative?.channel_summary?.length ?? 0) > 0;
  const hasLanguages = (insightData?.qualitative?.language_distribution?.length ?? 0) > 0;
  const hasEntities = (insightData?.qualitative?.entity_summary?.length ?? 0) > 0;
  const hasTotalPosts = (insightData?.quantitative?.total_posts?.length ?? 0) > 0;

  const title = collectionName ? `Insight Report: ${collectionName}` : 'Insight Report';

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-muted/50"
      >
        <div className="flex flex-col items-start gap-0.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
              <BarChart3 className="h-4 w-4 text-foreground" />
            </div>
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          </div>
          {dateRange && (
            <span className="ml-[38px] text-[11px] text-muted-foreground">{dateRange}</span>
          )}
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
        <div ref={contentRef} className="border-t border-border px-5 pb-5">
          {/* 1. Engagement metrics — 4-column row */}
          {hasEngagement && (
            <div className="mt-4">
              <EngagementMetrics data={insightData.quantitative.engagement_summary} />
            </div>
          )}

          {/* 2. Pie charts row — 3 columns: Sentiment, Language, Content Types */}
          {(hasSentiment || hasLanguages || hasContentTypes) && (
            <div className="mt-4 grid grid-cols-3 gap-4">
              {hasSentiment && (
                <ChartSection icon={<PieChart className="h-3.5 w-3.5" />} title="Sentiment">
                  <SentimentPie data={insightData.quantitative.sentiment_breakdown} />
                </ChartSection>
              )}
              {hasLanguages && (
                <ChartSection icon={<Globe className="h-3.5 w-3.5" />} title="Languages">
                  <LanguagePie data={insightData.qualitative.language_distribution} />
                </ChartSection>
              )}
              {hasContentTypes && (
                <ChartSection icon={<LayoutGrid className="h-3.5 w-3.5" />} title="Content Types">
                  <ContentTypeDonut data={insightData.qualitative.content_type_breakdown} />
                </ChartSection>
              )}
            </div>
          )}

          {/* 3. Volume over time — full width */}
          {hasVolume && (
            <div className="mt-4">
              <ChartSection icon={<TrendingUp className="h-3.5 w-3.5" />} title="Volume Over Time">
                <VolumeChart data={insightData.quantitative.volume_over_time} />
              </ChartSection>
            </div>
          )}

          {/* 4. Themes + Platform — 2-column grid */}
          {(hasThemes || hasTotalPosts) && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              {hasThemes && (
                <ChartSection icon={<Layers className="h-3.5 w-3.5" />} title="Top Themes">
                  <ThemeBar data={insightData.qualitative.theme_distribution} />
                </ChartSection>
              )}
              {hasTotalPosts && (
                <ChartSection icon={<Hash className="h-3.5 w-3.5" />} title="Posts by Platform">
                  <PlatformBar data={insightData.quantitative.total_posts} />
                </ChartSection>
              )}
            </div>
          )}

          {/* 5. Entities table — full width */}
          {hasEntities && (
            <div className="mt-4">
              <ChartSection icon={<Users className="h-3.5 w-3.5" />} title="Top Entities">
                <EntityTable data={insightData.qualitative.entity_summary} />
              </ChartSection>
            </div>
          )}

          {/* 6. Channels table — full width */}
          {hasChannels && (
            <div className="mt-4">
              <ChartSection icon={<Users className="h-3.5 w-3.5" />} title="Top Channels">
                <ChannelTable data={insightData.quantitative.channel_summary} />
              </ChartSection>
            </div>
          )}

          {/* 7. Narrative — bottom */}
          {narrative && (
            <div className="mt-4 rounded-md border border-border bg-card p-4">
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
