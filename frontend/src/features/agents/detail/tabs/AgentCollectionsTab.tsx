import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Database, Download, Filter, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { listCollections, downloadCollection, deleteCollection } from '../../../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../../../collections/utils.ts';
import { CollectionsSidebar } from '../../../collections/CollectionsSidebar.tsx';
import { PostsDataPanel } from '../../../collections/PostsDataPanel.tsx';
import { EditCollectionDialog } from '../../../collections/EditCollectionDialog.tsx';
import { StatsModal } from '../../../sources/StatsModal.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { useAuth } from '../../../../auth/useAuth.ts';
import type { Source } from '../../../../stores/sources-store.ts';

type StatusFilter = 'all' | 'active' | 'monitoring' | 'completed' | 'failed';

interface TaskCollectionsTabProps {
  task: Agent;
}

export function AgentCollectionsTab({ task }: TaskCollectionsTabProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  // Sidebar state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Global search for posts data panel
  const [globalSearch, setGlobalSearch] = useState('');

  // Dialog state
  const [editSource, setEditSource] = useState<Source | null>(null);
  const [statsSource, setStatsSource] = useState<Source | null>(null);

  // Active column filters state
  const [hasActiveColumnFilters, setHasActiveColumnFilters] = useState(false);
  const clearFiltersRef = useRef<(() => void) | null>(null);

  // Fetch all collections, then filter to only those in this agent
  const taskCollectionIds = useMemo(
    () => new Set(task.collection_ids ?? []),
    [task.collection_ids],
  );

  const { data: rawCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 30_000,
  });

  // Map → Source objects, filtered to only this agent's collections
  const collections: Source[] = useMemo(
    () =>
      rawCollections
        .filter((c) => taskCollectionIds.has(c.collection_id))
        .map(mapCollectionToSource),
    [rawCollections, taskCollectionIds],
  );

  // Auto-select all task collections on initial load
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && collections.length > 0) {
      didAutoSelect.current = true;
      setSelectedIds(new Set(collections.map((c) => c.collectionId)));
    }
  }, [collections]);

  // Build collection name map for the data panel
  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) map.set(c.collectionId, c.title);
    return map;
  }, [collections]);

  const selectedCollectionIds = useMemo(() => [...selectedIds], [selectedIds]);

  const handleDownload = useCallback((source: Source) => {
    downloadCollection(source.collectionId, source.title);
  }, []);

  const handleDelete = useCallback(
    async (source: Source) => {
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
    },
    [queryClient],
  );

  // Empty state
  if (taskCollectionIds.size === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Database className="h-10 w-10 opacity-20" />
        <p className="text-sm font-medium">No collections yet</p>
        <p className="text-xs">Collections will appear here once the agent runs.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-card px-4 py-2 shrink-0">
        {/* Global post search */}
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search posts..."
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

        {/* Clear column filters */}
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

        {/* Export selected */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={selectedCollectionIds.length === 0}
          onClick={() => {
            for (const id of selectedCollectionIds) {
              downloadCollection(id, collectionNames.get(id) ?? id);
            }
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Main: sidebar + data panel */}
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

      {/* Edit Dialog */}
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
    </div>
  );
}
