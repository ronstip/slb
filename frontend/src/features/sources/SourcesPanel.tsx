import { FolderOpen, Loader2, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { listCollections } from '../../api/endpoints/collections.ts';
import { SourceCard } from './SourceCard.tsx';
import { CollectionPicker } from './CollectionPicker.tsx';
import type { CollectionStatusResponse } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';

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
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const sources = useSourcesStore((s) => s.sources);
  const setSources = useSourcesStore((s) => s.setSources);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Fetch all collections and auto-populate the store
  const { data: allCollections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!allCollections || allCollections.length === 0) return;
    const currentSources = useSourcesStore.getState().sources;
    const existingIds = new Set(currentSources.map((s) => s.collectionId));
    const newCollections = allCollections.filter((c) => !existingIds.has(c.collection_id));
    if (newCollections.length === 0) return;

    const newSources = newCollections.map(mapCollectionToSource);
    setSources([...currentSources, ...newSources]);
  }, [allCollections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show collections that are active in this session
  const sessionSources = sources.filter((s) => s.selected);

  const isEmpty = sessionSources.length === 0;

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
          {isEmpty ? (
            /* ── Empty state: centered "+ Add Collection" ── */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6">
              {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
              ) : (
                <>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full gap-2 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-transparent py-8 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary"
                      >
                        <Plus className="h-4 w-4" />
                        Add Collection
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="center" side="bottom">
                      <CollectionPicker onClose={() => setPickerOpen(false)} />
                    </PopoverContent>
                  </Popover>
                  <div className="flex flex-col items-center gap-2">
                    <FolderOpen className="h-8 w-8 text-muted-foreground/25" />
                    <p className="text-center text-xs text-muted-foreground/60">
                      No collections in this session
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ── Has collections: button at top + card list ── */
            <>
              <div className="p-3 pb-2">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full gap-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" />
                      Add Collection
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0"
                    style={{ width: 'var(--radix-popover-trigger-width)' }}
                    align="start"
                    side="bottom"
                  >
                    <CollectionPicker onClose={() => setPickerOpen(false)} />
                  </PopoverContent>
                </Popover>
              </div>

              <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
                <div className="flex flex-col gap-0.5 px-3 pb-3">
                  {sessionSources.map((source) => (
                    <SourceCard key={source.collectionId} source={source} />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      )}
    </div>
  );
}
