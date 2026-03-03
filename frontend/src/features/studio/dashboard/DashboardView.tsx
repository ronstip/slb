import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, AlertTriangle } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import type { Artifact } from '../../../stores/studio-store.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { cn } from '../../../lib/utils.ts';
import { getDashboardData } from '../../../api/endpoints/dashboard.ts';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';

// Chart components (reused from insight report)
import { KpiGrid } from '../../chat/cards/report/KpiGrid.tsx';
import { SentimentPie } from '../charts/SentimentPie.tsx';
import { PlatformBar } from '../charts/PlatformBar.tsx';
import { VolumeChart } from '../charts/VolumeChart.tsx';
import { ContentTypeDonut } from '../charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../charts/LanguagePie.tsx';
import { ThemeBar } from '../charts/ThemeBar.tsx';
import { EntityTable } from '../charts/EntityTable.tsx';
import { ChannelTable } from '../charts/ChannelTable.tsx';

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
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={collapseReport}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold text-foreground truncate">{artifact.title}</h2>
        </div>
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
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
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
          <div ref={contentRef} className="space-y-4 p-4">
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

            {/* KPI row */}
            <KpiGrid data={{ items: kpis }} />

            {/* Chart grid */}
            <div className="grid grid-cols-2 gap-4">
              <ChartCard title="Sentiment">
                <SentimentPie data={sentimentData} />
              </ChartCard>

              <ChartCard title="Platform">
                <PlatformBar data={platformData} />
              </ChartCard>

              <ChartCard title="Volume Over Time" fullWidth>
                <VolumeChart data={volumeData} />
              </ChartCard>

              <ChartCard title="Content Type">
                <ContentTypeDonut data={contentTypeData} />
              </ChartCard>

              <ChartCard title="Language">
                <LanguagePie data={languageData} />
              </ChartCard>

              <ChartCard title="Top Themes" fullWidth>
                <ThemeBar data={themeData} />
              </ChartCard>

              <ChartCard title="Top Entities" fullWidth>
                <EntityTable data={entityData} />
              </ChartCard>

              <ChartCard title="Top Channels" fullWidth>
                <ChannelTable data={channelData} />
              </ChartCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children, fullWidth }: { title: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', fullWidth && 'col-span-2')}>
      <h3 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

