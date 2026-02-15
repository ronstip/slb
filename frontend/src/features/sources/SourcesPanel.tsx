import { PanelLeftClose, PanelLeftOpen, Plus, ChevronDown, Loader2, Search, X, FolderOpen, Users } from 'lucide-react';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { listCollections, getCollectionStatus } from '../../api/endpoints/collections.ts';
import { SourceCard } from './SourceCard.tsx';
import type { CollectionStatusResponse } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';

function mapCollectionToSource(c: CollectionStatusResponse) {
  return {
    collectionId: c.collection_id,
    status: c.status,
    config: c.config ?? {
      platforms: [],
      keywords: [],
      channel_urls: [],
      time_range: { start: '', end: '' },
      max_calls: 0,
      include_comments: false,
      geo_scope: 'global',
    },
    title: c.config?.keywords?.join(', ') || `Collection ${c.collection_id.slice(0, 8)}`,
    postsCollected: c.posts_collected,
    postsEnriched: c.posts_enriched,
    postsEmbedded: c.posts_embedded,
    selected: false,
    createdAt: c.created_at ?? new Date().toISOString(),
    errorMessage: c.error_message,
    visibility: (c.visibility as 'private' | 'org') ?? 'private',
    userId: c.user_id ?? undefined,
  };
}

export function SourcesPanel() {
  const { profile } = useAuth();
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const openModal = useUIStore((s) => s.openCollectionModal);
  const sources = useSourcesStore((s) => s.sources);
  const addSource = useSourcesStore((s) => s.addSource);
  const setSources = useSourcesStore((s) => s.setSources);

  const [searchQuery, setSearchQuery] = useState('');
  const [idInputOpen, setIdInputOpen] = useState(false);
  const [collectionIdValue, setCollectionIdValue] = useState('');
  const [idLoading, setIdLoading] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch all collections and auto-populate the store
  const { data: allCollections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
    staleTime: 30_000,
  });

  // Auto-load collections into the store when data arrives
  useEffect(() => {
    if (!allCollections || allCollections.length === 0) return;
    const existingIds = new Set(sources.map((s) => s.collectionId));
    const newCollections = allCollections.filter((c) => !existingIds.has(c.collection_id));
    if (newCollections.length === 0) return;

    // Preserve existing sources (with their selected state), add new ones
    const newSources = newCollections.map(mapCollectionToSource);
    setSources([...sources, ...newSources]);
  }, [allCollections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Split into My Collections vs Shared with me
  const { myCollections, sharedCollections } = useMemo(() => {
    const mine: typeof sources = [];
    const shared: typeof sources = [];
    for (const s of sources) {
      if (!s.userId || s.userId === profile?.uid) {
        mine.push(s);
      } else {
        shared.push(s);
      }
    }
    return { myCollections: mine, sharedCollections: shared };
  }, [sources, profile?.uid]);

  // Filter by search query
  const filterBySearch = (list: typeof sources) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.config.keywords.some((k) => k.toLowerCase().includes(q)) ||
        s.config.platforms.some((p) => p.toLowerCase().includes(q)),
    );
  };

  const filteredMine = filterBySearch(myCollections);
  const filteredShared = filterBySearch(sharedCollections);

  const handleAddById = async () => {
    const id = collectionIdValue.trim();
    if (!id) return;
    setIdLoading(true);
    setIdError(null);
    try {
      const c = await getCollectionStatus(id);
      addSource({
        ...mapCollectionToSource(c),
        selected: true,
      });
      setCollectionIdValue('');
      setIdInputOpen(false);
    } catch {
      setIdError('Collection not found');
    } finally {
      setIdLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Collections
          </span>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Add Collection button */}
          <div className="relative p-3 pb-0" ref={menuRef}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  New Collection
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuItem onClick={() => openModal()}>
                  Create Collection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setIdInputOpen(true); setIdError(null); }}>
                  Add by Collection ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Add by ID inline input */}
          {idInputOpen && (
            <div className="px-3 pt-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={collectionIdValue}
                  onChange={(e) => { setCollectionIdValue(e.target.value); setIdError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddById(); }}
                  placeholder="Paste collection ID..."
                  autoFocus
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={handleAddById}
                  disabled={idLoading || !collectionIdValue.trim()}
                  className="h-8 text-xs"
                >
                  {idLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => { setIdInputOpen(false); setCollectionIdValue(''); setIdError(null); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {idError && (
                <p className="mt-1 text-[10px] text-destructive">{idError}</p>
              )}
            </div>
          )}

          {/* Search bar */}
          <div className="px-3 pt-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search collections..."
                className="h-8 pl-7 text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable content area — padding is INSIDE the wrapper so
               the Radix viewport width stays constrained to the panel */}
          <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
            <div className="px-3 pb-3">
              {/* Loading state */}
              {isLoading && sources.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Empty state */}
              {!isLoading && sources.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    No collections yet
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Create your first collection to start listening
                  </p>
                </div>
              )}

              {/* My Collections */}
              {filteredMine.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 px-0.5 pt-1">
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      My Collections
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {filteredMine.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filteredMine.map((source) => (
                      <SourceCard key={source.collectionId} source={source} />
                    ))}
                  </div>
                </div>
              )}

              {/* Shared with me */}
              {filteredShared.length > 0 && (
                <div className={filteredMine.length > 0 ? 'mt-3' : ''}>
                  <div className="mb-1.5 flex items-center gap-1.5 px-0.5 pt-1">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Shared with me
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {filteredShared.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filteredShared.map((source) => (
                      <SourceCard key={source.collectionId} source={source} />
                    ))}
                  </div>
                </div>
              )}

              {/* No search results */}
              {searchQuery && filteredMine.length === 0 && filteredShared.length === 0 && sources.length > 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    No collections match "{searchQuery}"
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
