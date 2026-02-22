import { useState, useMemo } from 'react';
import { Check, FolderOpen, Loader2, Plus, Search, Users, X } from 'lucide-react';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { getCollectionStatus } from '../../api/endpoints/collections.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import type { Source } from '../../stores/sources-store.ts';

interface CollectionPickerProps {
  onClose: () => void;
}

function mapCollectionToSource(c: Awaited<ReturnType<typeof getCollectionStatus>>) {
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
    active: false,
    createdAt: c.created_at ?? new Date().toISOString(),
    errorMessage: c.error_message,
    visibility: (c.visibility as 'private' | 'org') ?? 'private',
    userId: c.user_id ?? undefined,
  };
}

function PickerRow({ source, onSelect }: { source: Source; onSelect: () => void }) {
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
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        source.selected && 'bg-primary/5',
      )}
      onClick={onSelect}
    >
      {/* Checkmark indicator */}
      <div
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
          source.selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40',
        )}
      >
        {source.selected && <Check className="h-2.5 w-2.5" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
          <span className="truncate text-[12px] font-medium leading-tight">{source.title}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-x-1 text-[10px] text-muted-foreground">
          <span>{formatNumber(source.postsCollected)} posts</span>
          {platforms && (
            <>
              <span className="text-border">·</span>
              <span className="truncate">{platforms}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CollectionPicker({ onClose }: CollectionPickerProps) {
  const { profile } = useAuth();
  const sources = useSourcesStore((s) => s.sources);
  const addToSession = useSourcesStore((s) => s.addToSession);
  const addSource = useSourcesStore((s) => s.addSource);
  const openModal = useUIStore((s) => s.openCollectionModal);

  const [search, setSearch] = useState('');
  const [idInputOpen, setIdInputOpen] = useState(false);
  const [collectionIdValue, setCollectionIdValue] = useState('');
  const [idLoading, setIdLoading] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);

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

  // Only show collections not already in session
  const filteredMine = filterSources(myCollections.filter((s) => !s.selected));
  const filteredShared = filterSources(sharedCollections.filter((s) => !s.selected));
  const hasResults = filteredMine.length > 0 || filteredShared.length > 0;

  const handleAddById = async () => {
    const id = collectionIdValue.trim();
    if (!id) return;
    setIdLoading(true);
    setIdError(null);
    try {
      const c = await getCollectionStatus(id);
      addSource({ ...mapCollectionToSource(c), selected: true, active: true });
      onClose();
    } catch {
      setIdError('Collection not found');
    } finally {
      setIdLoading(false);
    }
  };

  const handleSelect = (collectionId: string) => {
    addToSession(collectionId);
    onClose();
  };

  const handleCreateNew = () => {
    openModal();
    onClose();
  };

  return (
    <div className="flex flex-col">
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

      <Separator />

      {/* Collection list */}
      <ScrollArea className="max-h-64">
        <div className="p-2">
          {sources.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <FolderOpen className="mb-2 h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No collections yet</p>
            </div>
          )}

          {sources.length > 0 && !hasResults && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {search.trim()
                ? `No collections match "${search}"`
                : 'All collections are in this session'}
            </p>
          )}

          {/* My Collections */}
          {filteredMine.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 px-1 pt-0.5">
                <FolderOpen className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  My Collections
                </span>
              </div>
              {filteredMine.map((source) => (
                <PickerRow
                  key={source.collectionId}
                  source={source}
                  onSelect={() => handleSelect(source.collectionId)}
                />
              ))}
            </div>
          )}

          {/* Shared with me */}
          {filteredShared.length > 0 && (
            <div className={filteredMine.length > 0 ? 'mt-2' : ''}>
              <div className="mb-1 flex items-center gap-1 px-1 pt-0.5">
                <Users className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Shared with me
                </span>
              </div>
              {filteredShared.map((source) => (
                <PickerRow
                  key={source.collectionId}
                  source={source}
                  onSelect={() => handleSelect(source.collectionId)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* Footer actions */}
      <div className="p-2 space-y-1.5">
        {/* Add by ID */}
        {idInputOpen ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Input
                value={collectionIdValue}
                onChange={(e) => { setCollectionIdValue(e.target.value); setIdError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddById(); }}
                placeholder="Paste collection ID..."
                autoFocus
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                onClick={handleAddById}
                disabled={idLoading || !collectionIdValue.trim()}
                className="h-7 text-xs px-2"
              >
                {idLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => { setIdInputOpen(false); setCollectionIdValue(''); setIdError(null); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            {idError && <p className="text-[10px] text-destructive">{idError}</p>}
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 text-xs text-muted-foreground"
            onClick={() => { setIdInputOpen(true); setIdError(null); }}
          >
            Add by collection ID
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-1.5 text-xs"
          onClick={handleCreateNew}
        >
          <Plus className="h-3.5 w-3.5" />
          Create new collection
        </Button>
      </div>
    </div>
  );
}
