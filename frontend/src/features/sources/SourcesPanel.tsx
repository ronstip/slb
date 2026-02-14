import { PanelLeftClose, PanelLeftOpen, Plus, ChevronDown, Loader2, Clock, BarChart3, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { listCollections, getCollectionStatus } from '../../api/endpoints/collections.ts';
import { SourceCard } from './SourceCard.tsx';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
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

export function SourcesPanel() {
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const openModal = useUIStore((s) => s.openCollectionModal);
  const sources = useSourcesStore((s) => s.sources);
  const addSource = useSourcesStore((s) => s.addSource);
  const selectAll = useSourcesStore((s) => s.selectAll);
  const deselectAll = useSourcesStore((s) => s.deselectAll);
  const allSelected = sources.length > 0 && sources.every((s) => s.selected);
  const [idInputOpen, setIdInputOpen] = useState(false);
  const [collectionIdValue, setCollectionIdValue] = useState('');
  const [idLoading, setIdLoading] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: previousCollections, isLoading: loadingPrevious } = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
    staleTime: 30_000,
  });

  const activeIds = new Set(sources.map((s) => s.collectionId));
  const available = (previousCollections ?? []).filter((c) => !activeIds.has(c.collection_id));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // Keep for legacy click-outside if needed
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleAddById = async () => {
    const id = collectionIdValue.trim();
    if (!id) return;
    setIdLoading(true);
    setIdError(null);
    try {
      const c = await getCollectionStatus(id);
      addSource({
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
        selected: true,
        createdAt: c.created_at ?? new Date().toISOString(),
        errorMessage: c.error_message,
      });
      setCollectionIdValue('');
      setIdInputOpen(false);
    } catch {
      setIdError('Collection not found');
    } finally {
      setIdLoading(false);
    }
  };

  const handleAddPrevious = (c: CollectionStatusResponse) => {
    addSource({
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
      selected: true,
      createdAt: c.created_at ?? new Date().toISOString(),
      errorMessage: c.error_message,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sources
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
          {/* Add Source button */}
          <div className="relative p-3 pb-0" ref={menuRef}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  Add Source
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuItem onClick={() => openModal()}>
                  New Collection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setIdInputOpen(true); setIdError(null); }}>
                  Add by Collection ID
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  Upload Document <span className="ml-1 text-xs opacity-60">(Soon)</span>
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

          {/* Select All toggle */}
          {sources.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={allSelected ? deselectAll : selectAll}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
          )}

          {/* Scrollable content area */}
          <ScrollArea className="flex-1 px-3 pb-3">
            {/* Active sources */}
            {sources.length > 0 && (
              <div className="flex flex-col gap-2">
                {sources.map((source) => (
                  <SourceCard key={source.collectionId} source={source} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {sources.length === 0 && available.length === 0 && !loadingPrevious && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Add your first source.
                </p>
              </div>
            )}

            {/* Previous Collections */}
            {(available.length > 0 || loadingPrevious) && (
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Your Collections
                  </span>
                </div>

                {loadingPrevious ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {available.map((c) => (
                      <PreviousCollectionItem
                        key={c.collection_id}
                        collection={c}
                        onAdd={() => handleAddPrevious(c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function PreviousCollectionItem({
  collection,
  onAdd,
}: {
  collection: CollectionStatusResponse;
  onAdd: () => void;
}) {
  const title = collection.config?.keywords?.join(', ') || `Collection ${collection.collection_id.slice(0, 8)}`;
  const platforms = (collection.config?.platforms ?? [])
    .map((p) => PLATFORM_LABELS[p]?.slice(0, 2).toUpperCase() || p.slice(0, 2).toUpperCase())
    .join(' · ');

  return (
    <button
      onClick={onAdd}
      className="group flex w-full items-start gap-2.5 rounded-xl border border-border/30 bg-card/60 p-2.5 text-left transition-all hover:border-primary/30 hover:bg-card hover:shadow-sm"
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
        <BarChart3 className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{title}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {platforms && <span>{platforms}</span>}
          {platforms && collection.posts_collected > 0 && <span>·</span>}
          {collection.posts_collected > 0 && <span>{formatNumber(collection.posts_collected)} posts</span>}
          {collection.created_at && (
            <>
              <span>·</span>
              <span>{shortDate(collection.created_at)}</span>
            </>
          )}
        </div>
      </div>
      <span className="mt-0.5 shrink-0 rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Add
      </span>
    </button>
  );
}
