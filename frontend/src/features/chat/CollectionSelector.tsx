import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart2,
  Check,
  ChevronDown,
  Database,
  Download,
  Eye,
  EyeOff,
  Library,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  StopCircle,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import {
  listCollections,
  deleteCollection,
  downloadCollection,
  setCollectionVisibility,
  triggerCollection,
  updateCollectionMode,
} from '../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../collections/utils.ts';
import { PLATFORM_LABELS, SCHEDULE_UTC_TIMES, parseScheduleString } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { StatsModal } from '../sources/StatsModal.tsx';
import { TableModal } from '../sources/TableModal.tsx';

type RowAction =
  | 'stats'
  | 'table'
  | 'download'
  | 'trigger'
  | 'edit-schedule'
  | 'stop-monitoring'
  | 'set-schedule'
  | 'toggle-visibility'
  | 'delete';

function CollectionRow({
  source,
  onToggle,
  onAction,
  isOwner,
  isInOrg,
}: {
  source: Source;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
  isOwner: boolean;
  isInOrg: boolean;
}) {
  const isProcessing = source.status === 'collecting' || source.status === 'enriching' || source.status === 'pending';
  const isReady = source.status === 'completed';
  const isFailed = source.status === 'failed';
  const isMonitoring = source.status === 'monitoring';
  const isShared = source.visibility === 'org';

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
        'group flex w-full items-center gap-0.5 rounded-md pr-0.5 transition-colors hover:bg-muted/60',
        source.selected && 'bg-accent-vibrant/5',
      )}
    >
      {/* Clickable area for toggle */}
      <button
        type="button"
        className="flex flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
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

      {/* Three-dot menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => onAction('stats')}>
            <BarChart2 className="mr-2 h-3.5 w-3.5" /> View Stats
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('table')}>
            <Table2 className="mr-2 h-3.5 w-3.5" /> View Table
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('download')}>
            <Download className="mr-2 h-3.5 w-3.5" /> Download CSV
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {isOwner && isMonitoring && (
            <>
              <DropdownMenuItem onSelect={() => onAction('trigger')}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Run Now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('edit-schedule')}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Edit Schedule
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('stop-monitoring')}>
                <StopCircle className="mr-2 h-3.5 w-3.5" /> Stop Monitoring
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {isOwner && isReady && !source.config.ongoing && (
            <>
              <DropdownMenuItem onSelect={() => onAction('set-schedule')}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Set Schedule...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {isOwner && isInOrg && (
            <DropdownMenuItem onSelect={() => onAction('toggle-visibility')}>
              {isShared ? (
                <><EyeOff className="mr-2 h-3.5 w-3.5" /> Make Private</>
              ) : (
                <><Eye className="mr-2 h-3.5 w-3.5" /> Share with Org</>
              )}
            </DropdownMenuItem>
          )}

          {isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onAction('delete')}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  const updateSource = useSourcesStore((s) => s.updateSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const openCollectionsLibrary = useUIStore((s) => s.openCollectionsLibrary);
  const openCollectionModal = useUIStore((s) => s.openCollectionModal);
  const queryClient = useQueryClient();

  // Modal state (lifted here so modals survive popover close)
  const [modalSource, setModalSource] = useState<Source | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);
  const [scheduleDays, setScheduleDays] = useState(1);
  const [scheduleTime, setScheduleTime] = useState('06:00');

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

  // Action handlers (copied from CollectionLibraryCard)
  const handleDelete = async () => {
    if (!modalSource) return;
    setDeleting(true);
    try {
      await deleteCollection(modalSource.collectionId);
      removeSource(modalSource.collectionId);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setDeleteDialogOpen(false);
      setModalSource(null);
    } catch {
      // handle error
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async (source: Source) => {
    try {
      await downloadCollection(source.collectionId, source.title);
    } catch {
      // handle error
    }
  };

  const handleTriggerNow = async (source: Source) => {
    try {
      await triggerCollection(source.collectionId);
      updateSource(source.collectionId, { status: 'collecting' });
      queryClient.invalidateQueries({ queryKey: ['collection-status', source.collectionId] });
    } catch {
      // handle error
    }
  };

  const handleToggleVisibility = async (source: Source) => {
    const newVisibility = source.visibility === 'org' ? 'private' : 'org';
    try {
      await setCollectionVisibility(source.collectionId, newVisibility);
      updateSource(source.collectionId, { visibility: newVisibility });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    }
  };

  const handleStopMonitoring = async (source: Source) => {
    try {
      await updateCollectionMode(source.collectionId, false);
      updateSource(source.collectionId, {
        status: 'completed',
        config: { ...source.config, ongoing: false, schedule: undefined },
      });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    }
  };

  const handleStartMonitoring = async (schedule: string) => {
    if (!modalSource) return;
    setTogglingMode(true);
    try {
      await updateCollectionMode(modalSource.collectionId, true, schedule);
      updateSource(modalSource.collectionId, {
        status: 'monitoring',
        config: { ...modalSource.config, ongoing: true, schedule },
      });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    } finally {
      setTogglingMode(false);
    }
  };

  const handleRowAction = (source: Source, action: RowAction) => {
    switch (action) {
      case 'stats':
        setModalSource(source);
        setStatsOpen(true);
        setOpen(false);
        break;
      case 'table':
        setModalSource(source);
        setTableOpen(true);
        setOpen(false);
        break;
      case 'download':
        handleDownload(source);
        break;
      case 'trigger':
        handleTriggerNow(source);
        break;
      case 'edit-schedule':
      case 'set-schedule': {
        const existing = parseScheduleString(source.config.schedule);
        setScheduleDays(existing.days);
        setScheduleTime(existing.time);
        setModalSource(source);
        setScheduleDialogOpen(true);
        setOpen(false);
        break;
      }
      case 'stop-monitoring':
        handleStopMonitoring(source);
        break;
      case 'toggle-visibility':
        handleToggleVisibility(source);
        break;
      case 'delete':
        setModalSource(source);
        setDeleteDialogOpen(true);
        setOpen(false);
        break;
    }
  };

  const isInOrg = !!profile?.org_id;

  return (
    <>
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
                    onAction={(action) => handleRowAction(source, action)}
                    isOwner={!source.userId || source.userId === profile?.uid}
                    isInOrg={isInOrg}
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
                    onAction={(action) => handleRowAction(source, action)}
                    isOwner={!source.userId || source.userId === profile?.uid}
                    isInOrg={isInOrg}
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

      {/* Modals — rendered outside Popover so they survive popover close */}
      {modalSource && (
        <>
          <StatsModal source={modalSource} open={statsOpen} onClose={() => { setStatsOpen(false); setModalSource(null); }} />
          <TableModal source={modalSource} open={tableOpen} onClose={() => { setTableOpen(false); setModalSource(null); }} />

          {/* Schedule Dialog */}
          <Dialog open={scheduleDialogOpen} onOpenChange={(v) => { setScheduleDialogOpen(v); if (!v) setModalSource(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Monitoring Schedule</DialogTitle>
                <DialogDescription>
                  Configure when this collection automatically refreshes.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={scheduleDays}
                    onChange={(e) => setScheduleDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                    className="w-14 rounded border border-input bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-muted-foreground">
                    {scheduleDays === 1 ? 'day' : 'days'} at
                  </span>
                  <Select value={scheduleTime} onValueChange={setScheduleTime}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_UTC_TIMES.map(({ label, value }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">UTC</span>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setScheduleDialogOpen(false); setModalSource(null); }}>Cancel</Button>
                <Button
                  onClick={() => {
                    handleStartMonitoring(`${scheduleDays}d@${scheduleTime}`);
                    setScheduleDialogOpen(false);
                    setModalSource(null);
                  }}
                  disabled={togglingMode}
                >
                  {modalSource.status === 'monitoring' ? 'Update Schedule' : 'Start Monitoring'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation */}
          <Dialog open={deleteDialogOpen} onOpenChange={(v) => { setDeleteDialogOpen(v); if (!v) setModalSource(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Collection</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete &quot;{modalSource.title}&quot;? This will permanently remove all collected data.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setModalSource(null); }}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
