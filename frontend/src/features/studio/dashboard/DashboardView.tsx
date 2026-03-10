import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, AlertTriangle, Share2, Table2 } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import type { Artifact } from '../../../stores/studio-store.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { getDashboardData } from '../../../api/endpoints/dashboard.ts';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';
import { ShareDashboardDialog } from './ShareDashboardDialog.tsx';
import { UnderlyingDataDialog } from '../UnderlyingDataDialog.tsx';
import { DashboardFilterBar } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import { DashboardContent } from './DashboardContent.tsx';

type DashboardArtifact = Extract<Artifact, { type: 'dashboard' }>;

interface DashboardViewProps {
  artifact: DashboardArtifact;
}

export function DashboardView({ artifact }: DashboardViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['dashboard-data', ...artifact.collectionIds],
    queryFn: () => getDashboardData(artifact.collectionIds),
    staleTime: 5 * 60 * 1000,
  });

  const allPosts = response?.posts ?? [];

  const {
    filters,
    toggleFilterValue,
    setFilter,
    filteredPosts,
    availableOptions,
    activeFilterCount,
    clearAll,
  } = useDashboardFilters(allPosts);

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
            onClick={() => setShowUnderlyingData(true)}
          >
            <Table2 className="h-3.5 w-3.5" />
            Data
          </Button>
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
            <Skeleton className="h-10 rounded-lg" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
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
          <div ref={contentRef}>
            <DashboardContent
              filteredPosts={filteredPosts}
              allPostsCount={allPosts.length}
              activeFilterCount={activeFilterCount}
              truncated={response?.truncated}
              filters={filters}
              toggleFilterValue={toggleFilterValue}
            />
          </div>
        )}
      </div>
      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}
