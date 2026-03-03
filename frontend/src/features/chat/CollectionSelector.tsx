import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Database, Library, Plus, Search, X } from 'lucide-react';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { listCollections } from '../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../collections/utils.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';

function CollectionRow({ source, onToggle }: { source: Source; onToggle: () => void }) {
  const isProcessing = source.status === 'collecting' || source.status === 'enriching' || source.status === 'pending';
  const isReady = source.status === 'completed';
  const isFailed = source.status === 'failed';

  const statusDot = isProcessing
    ? 'bg-amber-500 animate-pulse'
    : isReady
      ? 'bg-emerald-500'
      : isFailed
        ? 'bg-red-500'
        : 'bg-muted-foreground';

  const platforms = source.config.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60',
        source.selected && 'bg-accent-vibrant/5',
      )}
      onClick={onToggle}
    >
      {/* Checkmark */}
      <div
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
          source.selected
            ? 'border-foreground bg-foreground text-background'
            : 'border-muted-foreground/30',
        )}
      >
        {source.selected && <Check className="h-2.5 w-2.5" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
          <span className="truncate text-[12px] font-medium">{source.title}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-x-1 text-[10px] text-muted-foreground">
          <span>{formatNumber(source.postsCollected)} posts</span>
          {platforms && (
            <>
              <span className="opacity-30">·</span>
              <span className="truncate">{platforms}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

export function CollectionSelector() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { profile } = useAuth();
  const sources = useSourcesStore((s) => s.sources);
  const setSources = useSourcesStore((s) => s.setSources);
  const addToSession = useSourcesStore((s) => s.addToSession);
  const removeFromSession = useSourcesStore((s) => s.removeFromSession);
  const openCollectionsLibrary = useUIStore((s) => s.openCollectionsLibrary);
  const openCollectionModal = useUIStore((s) => s.openCollectionModal);

  // Fetch collections when dropdown opens (same query key as CollectionsLibrary — cached/deduped)
  const { data: allCollections } = useQuery({
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

  const activeCount = sources.filter((s) => s.selected).length;

  const { myCollections, sharedCollections } = useMemo(() => {
    const mine: Source[] = [];
    const shared: Source[] = [];
    for (const s of sources) {
      if (!s.userId || s.userId === profile?.uid) {
        mine.push(s);
      } else {
        shared.push(s);
      }
    }
    return { myCollections: mine, sharedCollections: shared };
  }, [sources, profile?.uid]);

  const filterSources = (list: Source[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.config.keywords.some((k) => k.toLowerCase().includes(q)) ||
        s.config.platforms.some((p) => p.toLowerCase().includes(q)),
    );
  };

  const filteredMine = filterSources(myCollections);
  const filteredShared = filterSources(sharedCollections);
  const hasResults = filteredMine.length > 0 || filteredShared.length > 0;

  const handleToggle = (source: Source) => {
    if (source.selected) {
      removeFromSession(source.collectionId);
    } else {
      addToSession(source.collectionId);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Database className="h-3.5 w-3.5" />
          <span className="font-medium">Collections</span>
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-vibrant px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 p-0"
      >
        {/* Search */}
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search collections..."
              className="h-8 pl-7 text-xs"
              autoFocus
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
        </div>

        <div className="border-t border-border" />

        {/* Collection list */}
        <div className="max-h-64 overflow-y-auto p-1.5">
          {sources.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Database className="mb-2 h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No collections yet</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                Start a chat to create your first collection.
              </p>
            </div>
          )}

          {sources.length > 0 && !hasResults && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No collections match "{search}"
            </p>
          )}

          {/* My Collections */}
          {filteredMine.length > 0 && (
            <div>
              {filteredShared.length > 0 && (
                <div className="mb-0.5 px-2.5 pt-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    My Collections
                  </span>
                </div>
              )}
              {filteredMine.map((source) => (
                <CollectionRow
                  key={source.collectionId}
                  source={source}
                  onToggle={() => handleToggle(source)}
                />
              ))}
            </div>
          )}

          {/* Shared */}
          {filteredShared.length > 0 && (
            <div className={filteredMine.length > 0 ? 'mt-1.5' : ''}>
              <div className="mb-0.5 px-2.5 pt-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Shared with me
                </span>
              </div>
              {filteredShared.map((source) => (
                <CollectionRow
                  key={source.collectionId}
                  source={source}
                  onToggle={() => handleToggle(source)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Footer */}
        <div className="flex items-center gap-1 p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 justify-start gap-1.5 text-xs text-muted-foreground"
            onClick={() => { openCollectionModal(); setOpen(false); }}
          >
            <Plus className="h-3.5 w-3.5" />
            New collection
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 justify-start gap-1.5 text-xs text-muted-foreground"
            onClick={() => { openCollectionsLibrary(); setOpen(false); }}
          >
            <Library className="h-3.5 w-3.5" />
            Manage all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
