import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, AlertTriangle, Share2 } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import type { Artifact } from '../../../stores/studio-store.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { getDashboardData } from '../../../api/endpoints/dashboard.ts';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';
import { ShareDashboardDialog } from './ShareDashboardDialog.tsx';
import { ChartCard } from './ChartCard.tsx';

// Chart components
import { KpiGrid } from '../../chat/cards/report/KpiGrid.tsx';
import { SentimentPie } from '../charts/SentimentPie.tsx';
import { PlatformBar } from '../charts/PlatformBar.tsx';
import { VolumeChart } from '../charts/VolumeChart.tsx';
import { ContentTypeDonut } from '../charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../charts/LanguagePie.tsx';
import { ThemeBar } from '../charts/ThemeBar.tsx';
import { EntityTable } from '../charts/EntityTable.tsx';
import { ChannelTable } from '../charts/ChannelTable.tsx';
import { SentimentLineChart } from '../charts/SentimentLineChart.tsx';

// Dashboard-specific
import { DashboardFilterBar } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import {
  aggregateSentiment,
  aggregatePlatforms,
  aggregateThemes,
  aggregateEntities,
  aggregateContentTypes,
  aggregateLanguages,
  aggregateVolume,
  aggregateChannels,
  aggregateSentimentOverTime,
  computeKpis,
} from './dashboard-aggregations.ts';

type DashboardArtifact = Extract<Artifact, { type: 'dashboard' }>;

interface DashboardViewProps {
  artifact: DashboardArtifact;
}

export function DashboardView({ artifact }: DashboardViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Fetch all posts for client-side filtering
  const { data: response, isLoading, error } = useQuery({
    queryKey: ['dashboard-data', ...artifact.collectionIds],
    queryFn: () => getDashboardData(artifact.collectionIds),
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const allPosts = response?.posts ?? [];

  // Filter state + filtered posts
  const {
    filters,
    toggleFilterValue,
    setFilter,
    filteredPosts,
    availableOptions,
    activeFilterCount,
    clearAll,
  } = useDashboardFilters(allPosts);

  // Aggregations (recomputed on every filter change via useMemo)
  const kpis = useMemo(() => computeKpis(filteredPosts), [filteredPosts]);
  const sentimentData = useMemo(() => aggregateSentiment(filteredPosts), [filteredPosts]);
  const platformData = useMemo(() => aggregatePlatforms(filteredPosts), [filteredPosts]);
  const volumeData = useMemo(() => aggregateVolume(filteredPosts), [filteredPosts]);
  const contentTypeData = useMemo(() => aggregateContentTypes(filteredPosts), [filteredPosts]);
  const languageData = useMemo(() => aggregateLanguages(filteredPosts), [filteredPosts]);
  const themeData = useMemo(() => aggregateThemes(filteredPosts), [filteredPosts]);
  const entityData = useMemo(() => aggregateEntities(filteredPosts), [filteredPosts]);
  const channelData = useMemo(() => aggregateChannels(filteredPosts), [filteredPosts]);
  const sentimentOverTimeData = useMemo(() => aggregateSentimentOverTime(filteredPosts), [filteredPosts]);

  const handleDownload = async () => {
    if (!contentRef.current) return;
    setDownloading(true);
    try {
      await downloadReportPdf(contentRef.current, `dashboard-${artifact.id}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={collapseReport}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-4 w-px bg-border" />
          <h2 className="text-sm font-semibold text-foreground truncate max-w-[200px]">{artifact.title}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShareOpen(true)}
            disabled={isLoading}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleDownload}
            disabled={downloading || isLoading}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            PDF
          </Button>
        </div>
      </div>

      <ShareDashboardDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dashboardId={artifact.id}
        collectionIds={artifact.collectionIds}
        title={artifact.title}
      />

      {/* Filter bar */}
      {!isLoading && !error && (
        <DashboardFilterBar
          filters={filters}
          availableOptions={availableOptions}
          activeFilterCount={activeFilterCount}
          onToggle={toggleFilterValue}
          onSetFilter={setFilter}
          onClearAll={clearAll}
          collectionNames={artifact.collectionNames}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-5">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="mt-3 text-sm font-medium text-destructive">Failed to load dashboard data</p>
            <p className="mt-1 text-xs text-muted-foreground">{String(error)}</p>
          </div>
        )}

        {!isLoading && !error && (
          <div ref={contentRef} className="space-y-8 p-6">
            {/* Truncation warning */}
            {response?.truncated && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Results capped at 5,000 posts. Filters apply to this subset.
              </div>
            )}

            {/* Post count indicator */}
            {activeFilterCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filteredPosts.length}</span> of {allPosts.length} posts
              </p>
            )}

            {/* ── SECTION 1: Overview ─────────────────────────────── */}
            <section>
              <SectionHeader label="Overview" />
              <KpiGrid data={{ items: kpis }} />
            </section>

            {/* ── SECTION 2: Distribution ─────────────────────────── */}
            <section>
              <SectionHeader label="Distribution" />
              <div className="grid grid-cols-2 gap-5">
                <ChartCard
                  title="Sentiment"
                  info="Breakdown of post sentiment classified by AI"
                >
                  <SentimentPie data={sentimentData} />
                </ChartCard>

                <ChartCard
                  title="Platform"
                  info="Post volume by social media platform"
                >
                  <PlatformBar data={platformData} />
                </ChartCard>

                <ChartCard
                  title="Content Type"
                  info="Distribution of content formats (video, image, text, etc.)"
                >
                  <ContentTypeDonut data={contentTypeData} />
                </ChartCard>

                <ChartCard
                  title="Language"
                  info="Post language distribution across all collected content"
                >
                  <LanguagePie data={languageData} />
                </ChartCard>
              </div>
            </section>

            {/* ── SECTION 3: Trends ───────────────────────────────── */}
            <section>
              <SectionHeader label="Trends" />
              <div className="space-y-5">
                <ChartCard
                  title="Volume Over Time"
                  subtitle="Daily post count across all platforms"
                  fullWidth
                >
                  <VolumeChart data={volumeData} />
                </ChartCard>

                <ChartCard
                  title="Sentiment Over Time"
                  subtitle="Daily sentiment distribution trends"
                  info="Shows how positive, negative, neutral, and mixed sentiment has evolved over the collection period"
                  fullWidth
                >
                  <SentimentLineChart data={sentimentOverTimeData} />
                </ChartCard>
              </div>
            </section>

            {/* ── SECTION 4: Deep Dive ────────────────────────────── */}
            <section>
              <SectionHeader label="Deep Dive" />
              <div className="space-y-5">
                <ChartCard
                  title="Top Themes"
                  subtitle="Most discussed topics across posts"
                  info="Themes are AI-extracted topics from post content"
                  fullWidth
                >
                  <ThemeBar data={themeData} />
                </ChartCard>

                <ChartCard
                  title="Top Entities"
                  subtitle="People, brands, and places mentioned most"
                  info="Entities are named items (people, brands, products, places) extracted by AI"
                  fullWidth
                >
                  <EntityTable data={entityData} />
                </ChartCard>

                <ChartCard
                  title="Top Channels"
                  subtitle="Most active sources in this dataset"
                  fullWidth
                >
                  <ChannelTable data={channelData} />
                </ChartCard>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </h2>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}
