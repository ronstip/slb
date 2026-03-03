import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { listCollections } from '../../api/endpoints/collections.ts';
import { mapCollectionToSource } from './utils.ts';
import { CollectionLibraryCard } from './CollectionLibraryCard.tsx';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { cn } from '../../lib/utils.ts';

type StatusFilter = 'all' | 'active' | 'monitoring' | 'completed' | 'failed';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Monitoring', value: 'monitoring' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
];

export function CollectionsLibrary() {
  const open = useUIStore((s) => s.collectionsLibraryOpen);
  const close = useUIStore((s) => s.closeCollectionsLibrary);
  const openCollectionModal = useUIStore((s) => s.openCollectionModal);
  const setSources = useSourcesStore((s) => s.setSources);
  const sources = useSourcesStore((s) => s.sources);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: allCollections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
    staleTime: 30_000,
    enabled: open,
  });

  // Sync fetched collections into the sources store
  useEffect(() => {
    if (!allCollections || allCollections.length === 0) return;
    const currentSources = useSourcesStore.getState().sources;
    const existingIds = new Set(currentSources.map((s) => s.collectionId));
    const newCollections = allCollections.filter((c) => !existingIds.has(c.collection_id));
    if (newCollections.length === 0) return;

    const newSources = newCollections.map(mapCollectionToSource);
    setSources([...currentSources, ...newSources]);
  }, [allCollections, setSources]);

  // Build the display list from the store (has up-to-date selected/active state)
  const filteredSources = useMemo(() => {
    let list = sources;

    // Status filter
    if (statusFilter === 'active') {
      list = list.filter((s) => s.status === 'collecting' || s.status === 'enriching' || s.status === 'pending');
    } else if (statusFilter === 'monitoring') {
      list = list.filter((s) => s.status === 'monitoring');
    } else if (statusFilter === 'completed') {
      list = list.filter((s) => s.status === 'completed');
    } else if (statusFilter === 'failed') {
      list = list.filter((s) => s.status === 'failed');
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const title = s.title.toLowerCase();
        const keywords = (s.config.keywords ?? []).join(' ').toLowerCase();
        const platforms = (s.config.platforms ?? []).join(' ').toLowerCase();
        return title.includes(q) || keywords.includes(q) || platforms.includes(q);
      });
    }

    // Sort: in-session first, then by date descending
    return [...list].sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [sources, statusFilter, search]);

  const handleNewCollection = () => {
    openCollectionModal();
    close();
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
      <SheetContent
        side="right"
        className="flex w-[680px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-lg">Collections</SheetTitle>
              <SheetDescription className="mt-0.5">
                Manage your data collections and add them to the current session.
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={close}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Toolbar */}
        <div className="border-b border-border px-5 py-3 space-y-3">
          {/* Search + New button */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, keyword, or platform..."
                className="h-8 pl-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleNewCollection}>
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  statusFilter === value
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Collection list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2 p-5">
            {isLoading && sources.length === 0 ? (
              // Loading skeletons
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex gap-1">
                    <Skeleton className="h-4 w-12 rounded-md" />
                    <Skeleton className="h-4 w-16 rounded-md" />
                  </div>
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : filteredSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Search className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="mt-3 text-sm font-medium text-muted-foreground">
                  {search || statusFilter !== 'all' ? 'No matching collections' : 'No collections yet'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {search || statusFilter !== 'all'
                    ? 'Try adjusting your search or filters.'
                    : 'Start a chat to create your first collection.'}
                </p>
              </div>
            ) : (
              filteredSources.map((source) => (
                <CollectionLibraryCard key={source.collectionId} source={source} />
              ))
            )}
          </div>
        </div>

        {/* Footer summary */}
        {sources.length > 0 && (
          <div className="border-t border-border px-5 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {sources.length} collection{sources.length !== 1 ? 's' : ''} total
              {filteredSources.length !== sources.length && ` · ${filteredSources.length} shown`}
              {' · '}
              {sources.filter((s) => s.selected).length} in session
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
