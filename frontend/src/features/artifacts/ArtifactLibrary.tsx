import { useState, useMemo } from 'react';
import {
  Search,
  X,
  Star,
  LayoutGrid,
  List,
  Layers,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useArtifactsList } from './hooks/useArtifacts.ts';
import { ArtifactLibraryCard } from './ArtifactLibraryCard.tsx';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { cn } from '../../lib/utils.ts';

type TypeFilter = 'all' | 'insight_report' | 'dashboard' | 'chart' | 'data_export';
type SortOption = 'recent' | 'title' | 'type';
type ViewMode = 'grid' | 'list';

const TYPE_FILTERS: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Reports', value: 'insight_report' },
  { label: 'Dashboards', value: 'dashboard' },
  { label: 'Charts', value: 'chart' },
  { label: 'Exports', value: 'data_export' },
];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: 'Most Recent', value: 'recent' },
  { label: 'Title A-Z', value: 'title' },
  { label: 'Type', value: 'type' },
];

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem('artifact-library-view');
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function ArtifactLibrary() {
  const open = useUIStore((s) => s.artifactLibraryOpen);
  const close = useUIStore((s) => s.closeArtifactLibrary);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);

  const { data: artifacts, isLoading } = useArtifactsList(open);

  const filtered = useMemo(() => {
    let list = artifacts ?? [];

    // Type filter
    if (typeFilter !== 'all') {
      list = list.filter((a) => a.type === typeFilter);
    }

    // Favorites filter
    if (favoritesOnly) {
      list = list.filter((a) => a.favorited);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q));
    }

    // Sort
    const sorted = [...list];
    if (sort === 'recent') {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sort === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'type') {
      sorted.sort((a, b) => a.type.localeCompare(b.type) || b.created_at.localeCompare(a.created_at));
    }

    // Favorited items float to top
    sorted.sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return 0;
    });

    return sorted;
  }, [artifacts, typeFilter, favoritesOnly, search, sort]);

  const toggleView = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('artifact-library-view', mode);
    } catch {
      // ignore
    }
  };

  const totalCount = artifacts?.length ?? 0;
  const favCount = artifacts?.filter((a) => a.favorited).length ?? 0;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
      <SheetContent
        side="right"
        className="flex w-[900px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-lg">Artifact Library</SheetTitle>
              <SheetDescription className="mt-0.5">
                Browse and reuse reports, charts, exports, and dashboards across sessions.
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
          {/* Search + view toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search artifacts..."
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

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* View toggle */}
            <div className="flex rounded-md border border-input">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 rounded-r-none', viewMode === 'grid' && 'bg-accent')}
                onClick={() => toggleView('grid')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 rounded-l-none border-l border-input', viewMode === 'list' && 'bg-accent')}
                onClick={() => toggleView('list')}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {/* Favorites chip */}
            <button
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                favoritesOnly
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              <Star className={cn('h-3 w-3', favoritesOnly && 'fill-current')} />
              Favorites
            </button>

            {/* Type chips */}
            {TYPE_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  typeFilter === value
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-5">
            {isLoading ? (
              <div className={cn(
                viewMode === 'grid'
                  ? 'grid grid-cols-3 gap-4'
                  : 'flex flex-col gap-2',
              )}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={cn(
                    'rounded-lg border border-border p-4 space-y-3',
                    viewMode === 'grid' && 'aspect-square',
                  )}>
                    <div className="flex items-start justify-between">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Layers className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="mt-3 text-sm font-medium text-muted-foreground">
                  {search || typeFilter !== 'all' || favoritesOnly
                    ? 'No matching artifacts'
                    : 'No artifacts yet'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {search || typeFilter !== 'all' || favoritesOnly
                    ? 'Try adjusting your search or filters.'
                    : 'Reports, charts, and exports created in sessions will appear here automatically.'}
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-3 gap-4">
                {filtered.map((a) => (
                  <ArtifactLibraryCard key={a.artifact_id} artifact={a} view="grid" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((a) => (
                  <ArtifactLibraryCard key={a.artifact_id} artifact={a} view="list" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {totalCount > 0 && (
          <div className="border-t border-border px-5 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {totalCount} artifact{totalCount !== 1 ? 's' : ''} total
              {filtered.length !== totalCount && ` · ${filtered.length} shown`}
              {favCount > 0 && ` · ${favCount} favorited`}
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
