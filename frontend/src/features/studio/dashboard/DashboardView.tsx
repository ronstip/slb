import { useRef, useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, AlertTriangle, Share2, Table2, Maximize2, Pencil } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import type { Artifact } from '../../../stores/studio-store.ts';
import { updateArtifact } from '../../../api/endpoints/artifacts.ts';
import { Input } from '../../../components/ui/input.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { getDashboardData } from '../../../api/endpoints/dashboard.ts';
import { exportDashboardPdf } from './exportDashboardPdf.ts';
import { ShareDashboardDialog } from './ShareDashboardDialog.tsx';
import { UnderlyingDataDialog } from '../UnderlyingDataDialog.tsx';
import { DashboardFilterBar, DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import type { FilterBarFilterId } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import { SocialDashboardView } from './SocialDashboardView.tsx';
import type { DashboardToolbarHandlers } from './SocialDashboardView.tsx';
import { SocialDashboardToolbar } from './SocialDashboardToolbar.tsx';

type DashboardArtifact = Extract<Artifact, { type: 'dashboard' }>;

interface DashboardViewProps {
  artifact: DashboardArtifact;
  standalone?: boolean;
  defaultLayout?: import('./types-social-dashboard.ts').SocialDashboardWidget[];
}

export function DashboardView({ artifact, standalone = false, defaultLayout }: DashboardViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const updateArtifactTitle = useStudioStore((s) => s.updateArtifactTitle);
  const gridRef = useRef<HTMLElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);
  const [filterBarFilters, setFilterBarFilters] = useState<FilterBarFilterId[]>(DEFAULT_FILTER_BAR_FILTERS);
  const [toolbarHandlers, setToolbarHandlers] = useState<DashboardToolbarHandlers | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [displayTitle, setDisplayTitle] = useState(artifact.title);
  const [titleDraft, setTitleDraft] = useState(artifact.title);

  const isEditMode = toolbarHandlers?.isEditMode ?? false;

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== displayTitle) {
      setDisplayTitle(trimmed);
      updateArtifactTitle(artifact.id, trimmed);
      updateArtifact(artifact.id, { title: trimmed }).catch(() => {
        // revert on failure
        setDisplayTitle(displayTitle);
        updateArtifactTitle(artifact.id, displayTitle);
      });
    } else {
      setTitleDraft(displayTitle);
    }
    setEditingTitle(false);
  };

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

  // Consume pending topic filter from TopicCard "Dashboard" button
  const pendingTopicFilter = useStudioStore((s) => s.pendingTopicFilter);
  const clearPendingTopicFilter = useStudioStore((s) => s.clearPendingTopicFilter);
  useEffect(() => {
    if (pendingTopicFilter) {
      setFilter('themes', pendingTopicFilter.themes);
      clearPendingTopicFilter();
    }
  }, [pendingTopicFilter, clearPendingTopicFilter, setFilter]);

  const handleDownload = async () => {
    if (!gridRef.current) return;
    setDownloading(true);
    try {
      await exportDashboardPdf(gridRef.current, displayTitle);
    } finally {
      setDownloading(false);
    }
  };

  const handleLayoutLoaded = useCallback((persisted: string[]) => {
    setFilterBarFilters(persisted as FilterBarFilterId[]);
  }, []);

  const handleToolbarReady = useCallback((handlers: DashboardToolbarHandlers) => {
    setToolbarHandlers(handlers);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-2.5">
        {!standalone && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={collapseReport}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-4 w-px bg-border shrink-0" />
          </>
        )}
        {/* Editable title */}
        {editingTitle ? (
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleDraft(displayTitle); setEditingTitle(false); } }}
            className="flex-1 h-7 text-sm font-semibold min-w-0"
          />
        ) : (
          <h2
            className={`flex-1 min-w-0 text-sm font-semibold text-foreground truncate ${isEditMode ? 'cursor-text hover:bg-muted/50 rounded px-1.5 py-0.5 -mx-1.5' : ''}`}
            onClick={() => { if (isEditMode) { setTitleDraft(displayTitle); setEditingTitle(true); } }}
          >
            {displayTitle}
            {isEditMode && <Pencil className="inline-block h-3 w-3 ml-1.5 text-muted-foreground" />}
          </h2>
        )}

        {/* Right-side controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Edit controls */}
          {toolbarHandlers && (
            <>
              <SocialDashboardToolbar
                isEditMode={toolbarHandlers.isEditMode}
                isSaving={toolbarHandlers.isSaving}
                onEdit={toolbarHandlers.onEdit}
                onDone={toolbarHandlers.onDone}
                onAddWidget={toolbarHandlers.onAddWidget}
                onResetToDefaults={toolbarHandlers.onResetToDefaults}
              />
              <div className="h-4 w-px bg-border shrink-0" />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowUnderlyingData(true)}
          >
            <Table2 className="h-3.5 w-3.5" />
            Data
          </Button>
          {!standalone && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => window.open(`/artifact/${artifact.id}`, '_blank')}
              title="Open in fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Fullscreen
            </Button>
          )}
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
          isEditMode={toolbarHandlers?.isEditMode ?? false}
          filterBarFilters={filterBarFilters}
          onFilterBarChange={(f) => setFilterBarFilters(f as FilterBarFilterId[])}
          allPosts={allPosts}
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
          <SocialDashboardView
            artifactId={artifact.id}
            filteredPosts={filteredPosts}
            allPosts={allPosts}
            availableOptions={availableOptions}
            truncated={response?.truncated}
            activeFilterCount={activeFilterCount}
            toggleFilterValue={toggleFilterValue}
            filterBarFilters={filterBarFilters}
            onLayoutLoaded={handleLayoutLoaded}
            onToolbarReady={handleToolbarReady}
            gridRef={gridRef}
            defaultLayout={defaultLayout}
          />
        )}
      </div>
      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}
