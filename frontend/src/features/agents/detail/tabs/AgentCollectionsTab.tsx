import { useState, useMemo, useRef, useEffect } from 'react';
import { Database, Download, Filter, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { listCollections, downloadCollection } from '../../../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../../../collections/utils.ts';
import { PostsDataPanel } from '../../../collections/PostsDataPanel.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import type { Source } from '../../../../stores/sources-store.ts';
import { StatusBadge } from '../agent-status-utils.tsx';
import { cn } from '../../../../lib/utils.ts';
import { formatNumber } from '../../../../lib/format.ts';

const STATUS_DOTS: Record<string, string> = {
  collecting: 'bg-amber-500 animate-pulse',
  enriching: 'bg-amber-500 animate-pulse',
  pending: 'bg-amber-500 animate-pulse',
  monitoring: 'bg-blue-500',
  completed: 'bg-green-500',
  completed_with_errors: 'bg-yellow-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

interface TaskCollectionsTabProps {
  task: Agent;
}

export function AgentCollectionsTab({ task }: TaskCollectionsTabProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [globalSearch, setGlobalSearch] = useState('');
  const [hasActiveColumnFilters, setHasActiveColumnFilters] = useState(false);
  const clearFiltersRef = useRef<(() => void) | null>(null);

  const taskCollectionIds = useMemo(
    () => new Set(task.collection_ids ?? []),
    [task.collection_ids],
  );

  const { data: rawCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 30_000,
  });

  const collections: Source[] = useMemo(
    () =>
      rawCollections
        .filter((c) => taskCollectionIds.has(c.collection_id))
        .map(mapCollectionToSource),
    [rawCollections, taskCollectionIds],
  );

  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && collections.length > 0) {
      didAutoSelect.current = true;
      setSelectedIds(new Set(collections.map((c) => c.collectionId)));
    }
  }, [collections]);

  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) map.set(c.collectionId, c.title);
    return map;
  }, [collections]);

  const selectedCollectionIds = useMemo(() => [...selectedIds], [selectedIds]);
  const allSelected = collections.length > 0 && selectedIds.size === collections.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(collections.map((c) => c.collectionId)));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  if (taskCollectionIds.size === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-3 px-6">
          <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Database className="h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">No collections yet</p>
          <p className="text-xs">Collections will appear here once the agent runs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Single header row: title + status + search + actions */}
      <div className="flex h-11 shrink-0 items-center gap-3 px-6">
        <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
        <StatusBadge status={task.status} />
        <div className="flex-1" />
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search posts..."
            className="h-7 pl-8 text-xs"
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {hasActiveColumnFilters && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
            onClick={() => clearFiltersRef.current?.()}
          >
            <Filter className="h-3 w-3" />
            Clear Filters
            <X className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
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

      {/* Horizontal collections bar — acts as the horizontal sidebar */}
      <div className="flex shrink-0 items-center gap-2 px-6 pb-2 overflow-x-auto">
        {/* "All" toggle */}
        {collections.length > 1 && (
          <button
            onClick={toggleAll}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
              allSelected
                ? 'border-primary/25 bg-primary/8 text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60',
            )}
          >
            <span>All</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {collections.reduce((s, c) => s + c.postsCollected, 0) > 0
                ? formatNumber(collections.reduce((s, c) => s + c.postsCollected, 0))
                : collections.length}
            </span>
          </button>
        )}

        {collections.map((c) => {
          const isSelected = selectedIds.has(c.collectionId);
          const statusDot = STATUS_DOTS[c.status] || 'bg-muted-foreground/40';
          // Extract first platform from config if available
          const platform = c.config?.platforms?.[0] as string | undefined;

          return (
            <button
              key={c.collectionId}
              onClick={() => toggleOne(c.collectionId)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all',
                isSelected
                  ? 'border-primary/25 bg-primary/8 text-foreground shadow-sm'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60',
              )}
            >
              {/* Status dot */}
              <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
              {/* Platform icon if available */}
              {platform && (
                <PlatformIcon platform={platform} className="h-3.5 w-3.5 shrink-0" />
              )}
              {/* Collection name */}
              <span className={cn('max-w-[160px] truncate font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>
                {c.title}
              </span>
              {/* Post count */}
              {c.postsCollected > 0 && (
                <span className={cn('shrink-0 tabular-nums text-[10px]', isSelected ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                  {formatNumber(c.postsCollected)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Full-width data panel */}
      <PostsDataPanel
        selectedCollectionIds={selectedCollectionIds}
        collectionNames={collectionNames}
        globalSearch={globalSearch}
        onActiveFiltersChange={setHasActiveColumnFilters}
        onClearFiltersCallbackChange={(cb) => { clearFiltersRef.current = cb; }}
      />

    </div>
  );
}
