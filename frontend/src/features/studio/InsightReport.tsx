import { useState, useRef } from 'react';
import { ArrowLeft, PieChart, TrendingUp, Layers, Users, Download, Loader2, Globe, Hash, LayoutGrid, ThumbsUp, Eye, MessageCircle, Share2 } from 'lucide-react';
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
import { LanguagePie } from './charts/LanguagePie.tsx';
import { EntityTable } from './charts/EntityTable.tsx';
import { PlatformBar } from './charts/PlatformBar.tsx';
import { downloadReportPdf } from '../../lib/download-pdf.ts';

interface InsightReportProps {
  artifact: Extract<Artifact, { type: 'insight_report' }>;
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </h4>
  );
}

function formatDateRange(dateFrom: string | null | undefined, dateTo: string | null | undefined): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
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

  const dateRange = formatDateRange(artifact.dateFrom, artifact.dateTo);

  const hasSentiment = (data?.quantitative?.sentiment_breakdown?.length ?? 0) > 0;
  const hasVolume = (data?.quantitative?.volume_over_time?.length ?? 0) > 0;
  const hasThemes = (data?.qualitative?.theme_distribution?.length ?? 0) > 0;
  const hasContentTypes = (data?.qualitative?.content_type_breakdown?.length ?? 0) > 0;
  const hasEngagement = (data?.quantitative?.engagement_summary?.length ?? 0) > 0;
  const hasChannels = (data?.quantitative?.channel_summary?.length ?? 0) > 0;
  const hasLanguages = (data?.qualitative?.language_distribution?.length ?? 0) > 0;
  const hasEntities = (data?.qualitative?.entity_summary?.length ?? 0) > 0;
  const hasTotalPosts = (data?.quantitative?.total_posts?.length ?? 0) > 0;

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
        {dateRange && (
          <p className="mt-0.5 text-xs text-muted-foreground">{dateRange}</p>
        )}

        {data && (
          <div className="mt-4 flex flex-col gap-4">
            {/* 1. Engagement metrics — 2x2 grid (fits narrow panel) */}
            {hasEngagement && (
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const totals = data.quantitative.engagement_summary.reduce(
                    (acc, d) => ({
                      likes: acc.likes + d.total_likes,
                      views: acc.views + d.total_views,
                      comments: acc.comments + d.total_comments,
                      shares: acc.shares + d.total_shares,
                    }),
                    { likes: 0, views: 0, comments: 0, shares: 0 },
                  );
                  const metrics = [
                    { label: 'Likes', value: totals.likes, icon: ThumbsUp },
                    { label: 'Views', value: totals.views, icon: Eye },
                    { label: 'Comments', value: totals.comments, icon: MessageCircle },
                    { label: 'Shares', value: totals.shares, icon: Share2 },
                  ];
                  return metrics.map(({ label, value, icon: Icon }) => (
                    <div key={label} className="rounded-md border border-border bg-card p-2">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Icon className="h-2.5 w-2.5" />
                        {label}
                      </div>
                      <p className="font-mono text-sm font-medium text-foreground">
                        {value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value)}
                      </p>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* 2. Charts — stacked single column */}
            {hasSentiment && (
              <div>
                <SectionHeader icon={<PieChart className="h-3.5 w-3.5" />} title="Sentiment" />
                <SentimentPie data={data.quantitative.sentiment_breakdown} />
              </div>
            )}
            {hasLanguages && (
              <div>
                <SectionHeader icon={<Globe className="h-3.5 w-3.5" />} title="Languages" />
                <LanguagePie data={data.qualitative.language_distribution} />
              </div>
            )}
            {hasContentTypes && (
              <div>
                <SectionHeader icon={<LayoutGrid className="h-3.5 w-3.5" />} title="Content Types" />
                <ContentTypeDonut data={data.qualitative.content_type_breakdown} />
              </div>
            )}
            {hasVolume && (
              <div>
                <SectionHeader icon={<TrendingUp className="h-3.5 w-3.5" />} title="Volume Over Time" />
                <VolumeChart data={data.quantitative.volume_over_time} />
              </div>
            )}
            {hasThemes && (
              <div>
                <SectionHeader icon={<Layers className="h-3.5 w-3.5" />} title="Top Themes" />
                <ThemeBar data={data.qualitative.theme_distribution} />
              </div>
            )}
            {hasTotalPosts && (
              <div>
                <SectionHeader icon={<Hash className="h-3.5 w-3.5" />} title="Posts by Platform" />
                <PlatformBar data={data.quantitative.total_posts} />
              </div>
            )}

            {/* Tables — full width, horizontal scroll for overflow */}
            {hasEntities && (
              <div>
                <SectionHeader icon={<Users className="h-3.5 w-3.5" />} title="Top Entities" />
                <div className="overflow-x-auto">
                  <EntityTable data={data.qualitative.entity_summary} />
                </div>
              </div>
            )}
            {hasChannels && (
              <div>
                <SectionHeader icon={<Users className="h-3.5 w-3.5" />} title="Top Channels" />
                <div className="overflow-x-auto">
                  <ChannelTable data={data.quantitative.channel_summary} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 7. Narrative — bottom */}
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
