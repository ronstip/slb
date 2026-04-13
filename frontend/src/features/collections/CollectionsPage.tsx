import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Download, Filter, Link2, Plus, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useUIStore } from '../../stores/ui-store.ts';
import { listCollections, downloadCollection, deleteCollection } from '../../api/endpoints/collections.ts';
import { mapCollectionToSource } from './utils.ts';
import { CollectionsSidebar } from './CollectionsSidebar.tsx';
import { PostsDataPanel } from './PostsDataPanel.tsx';
import { FeedLinkDialog } from './FeedLinkDialog.tsx';
import { EditCollectionDialog } from './EditCollectionDialog.tsx';
import { CollectionModal } from '../sources/CollectionModal.tsx';
import { StatsModal } from '../sources/StatsModal.tsx';
import { useAuth } from '../../auth/useAuth.ts';
import type { Source } from '../../stores/sources-store.ts';

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

export function CollectionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openCollectionModal = useUIStore((s) => s.openCollectionModal);
  const collectionModalOpen = useUIStore((s) => s.collectionModalOpen);
  const { profile } = useAuth();

  // Sidebar state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Global search for posts
  const [globalSearch, setGlobalSearch] = useState('');

  // Dialog state
  const [feedLinkOpen, setFeedLinkOpen] = useState(false);
  const [editSource, setEditSource] = useState<Source | null>(null);
  const [statsSource, setStatsSource] = useState<Source | null>(null);

  // Active column filters state (lifted here for clear filters button)
  const [hasActiveColumnFilters, setHasActiveColumnFilters] = useState(false);
  const clearFiltersRef = useRef<(() => void) | null>(null);

  // Fetch collections
  const { data: rawCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 30_000,
  });

  // Map to Source objects
  const collections: Source[] = useMemo(
    () => rawCollections.map(mapCollectionToSource),
    [rawCollections],
  );

  // Auto-select first completed collection if nothing is selected
  useEffect(() => {
    if (selectedIds.size === 0 && collections.length > 0) {
      const completed = collections.find((c) => c.status === 'success' && c.postsCollected > 0);
      if (completed) {
        setSelectedIds(new Set([completed.collectionId]));
      }
    }
  }, [collections]); // Only on initial load

  // Build collection name map for the data panel
  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) {
      map.set(c.collectionId, c.title);
    }
    return map;
  }, [collections]);

  const selectedCollectionIds = useMemo(() => [...selectedIds], [selectedIds]);

  // Build filters object for feed links
  const [currentFilters] = useState<Record<string, string>>({});

  const handleNewCollection = () => {
    openCollectionModal();
  };

  const handleDownload = useCallback((source: Source) => {
    downloadCollection(source.collectionId, source.title);
  }, []);

  const handleDelete = useCallback(async (source: Source) => {
    try {
      await deleteCollection(source.collectionId);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(source.collectionId);
        return next;
      });
      toast.success('Collection deleted');
    } catch {
      toast.error('Failed to delete collection');
    }
  }, [queryClient]);

  const handleExportCsv = () => {
    for (const id of selectedCollectionIds) {
      downloadCollection(id, collectionNames.get(id) ?? id);
    }
  };

  const hasSelection = selectedCollectionIds.length > 0;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Unified header: logo + search + actions */}
      <div className="flex items-center gap-3 border-b border-border/40 bg-card px-4 py-2 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border/50" />

        <Logo size="sm" showText className="shrink-0" />

        <span className="text-sm text-muted-foreground/50 font-light">/</span>
        <h1 className="text-sm font-semibold text-foreground/80">Collections</h1>

        <div className="h-5 w-px bg-border/50 ml-1" />

        {/* Global search */}
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search all posts..."
            className="h-8 pl-8 text-xs bg-background/60 border-border/40"
          />
          {globalSearch && (
            <button
              onClick={() => setGlobalSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Clear filters */}
        {hasActiveColumnFilters && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
            onClick={() => clearFiltersRef.current?.()}
          >
            <Filter className="h-3 w-3" />
            Clear Filters
            <X className="h-3 w-3" />
          </Button>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setFeedLinkOpen(true)}
          disabled={!hasSelection}
        >
          <Link2 className="h-3.5 w-3.5" />
          Feed Link
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleExportCsv}
          disabled={!hasSelection}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
        <Button size="sm" onClick={handleNewCollection} className="gap-1.5 ml-1">
          <Plus className="h-3.5 w-3.5" />
          New Collection
        </Button>
      </div>

      {/* Main content: sidebar + data panel */}
      <div className="flex flex-1 min-h-0">
        <CollectionsSidebar
          collections={collections}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onEdit={setEditSource}
          onViewStats={setStatsSource}
          onDownload={handleDownload}
          onDelete={handleDelete}
        />

        <PostsDataPanel
          selectedCollectionIds={selectedCollectionIds}
          collectionNames={collectionNames}
          globalSearch={globalSearch}
          onActiveFiltersChange={setHasActiveColumnFilters}
          onClearFiltersCallbackChange={(cb) => { clearFiltersRef.current = cb; }}
        />
      </div>

      {/* Feed Link Dialog */}
      <FeedLinkDialog
        open={feedLinkOpen}
        onClose={() => setFeedLinkOpen(false)}
        selectedCollectionIds={selectedCollectionIds}
        collectionNames={collectionNames}
        filters={currentFilters}
      />

      {/* Edit Collection Dialog */}
      <EditCollectionDialog
        source={editSource}
        open={!!editSource}
        onClose={() => setEditSource(null)}
        hasOrg={!!profile?.org_id}
      />

      {/* Stats Modal */}
      {statsSource && (
        <StatsModal
          source={statsSource}
          open={!!statsSource}
          onClose={() => setStatsSource(null)}
        />
      )}

      {/* Collection Modal — rendered here so it overlays this page */}
      {collectionModalOpen && <CollectionModal />}
    </div>
  );
}
