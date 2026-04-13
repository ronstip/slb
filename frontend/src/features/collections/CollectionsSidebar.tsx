import { useMemo } from 'react';
import {
  BarChart3,
  Download,
  Globe,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { cn } from '../../lib/utils.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import type { Source } from '../../stores/sources-store.ts';

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

const STATUS_FILTERS: { label: string; value: StatusFilter; color?: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active', color: '#f59e0b' },
  { label: 'Completed', value: 'completed', color: '#22c55e' },
  { label: 'Failed', value: 'failed', color: '#ef4444' },
];

const STATUS_DOTS: Record<string, string> = {
  running: 'bg-amber-500 animate-pulse',
  success: 'bg-green-500',
  failed: 'bg-red-500',
};

interface CollectionsSidebarProps {
  collections: Source[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  search: string;
  onSearchChange: (s: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  onEdit: (source: Source) => void;
  onViewStats: (source: Source) => void;
  onDownload: (source: Source) => void;
  onDelete: (source: Source) => void;
}

export function CollectionsSidebar({
  collections,
  selectedIds,
  onSelectionChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onEdit,
  onViewStats,
  onDownload,
  onDelete,
}: CollectionsSidebarProps) {
  const filteredCollections = useMemo(() => {
    let list = collections;

    if (statusFilter === 'active') {
      list = list.filter((s) => s.status === 'running');
    } else if (statusFilter === 'completed') {
      list = list.filter((s) => s.status === 'success');
    } else if (statusFilter === 'failed') {
      list = list.filter((s) => s.status === 'failed');
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const title = s.title.toLowerCase();
        const keywords = (s.config.keywords ?? []).join(' ').toLowerCase();
        const platforms = (s.config.platforms ?? []).join(' ').toLowerCase();
        return title.includes(q) || keywords.includes(q) || platforms.includes(q);
      });
    }

    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [collections, statusFilter, search]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectAll = () => {
    onSelectionChange(new Set(filteredCollections.map((c) => c.collectionId)));
  };

  const clearSelection = () => {
    onSelectionChange(new Set());
  };

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r border-border/50 bg-card">
      {/* Search */}
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search collections..."
            className="h-8 pl-8 text-xs bg-background/50 border-border/40"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Status filter chips */}
        <div className="flex gap-1">
          {STATUS_FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => onStatusFilterChange(value)}
              className={cn(
                'flex-1 rounded-full py-0.5 text-[10px] font-medium transition-all text-center',
                statusFilter === value
                  ? 'bg-foreground text-background shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-border/30 mx-3" />

      {/* Collection list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredCollections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Search className="h-5 w-5 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No matching collections</p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2 py-1.5">
            {filteredCollections.map((source) => (
              <CollectionSidebarItem
                key={source.collectionId}
                source={source}
                isSelected={selectedIds.has(source.collectionId)}
                onToggle={() => toggleSelection(source.collectionId)}
                onEdit={() => onEdit(source)}
                onViewStats={() => onViewStats(source)}
                onDownload={() => onDownload(source)}
                onDelete={() => onDelete(source)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-3 py-2 flex items-center justify-between bg-muted/20">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground/70">{selectedIds.size}</span> selected
          <span className="mx-1">of</span>
          {collections.length}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={selectAll}>
            All
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={clearSelection} disabled={selectedIds.size === 0}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar item                                                        */
/* ------------------------------------------------------------------ */

interface CollectionSidebarItemProps {
  source: Source;
  isSelected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onViewStats: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

function CollectionSidebarItem({
  source,
  isSelected,
  onToggle,
  onEdit,
  onViewStats,
  onDownload,
  onDelete,
}: CollectionSidebarItemProps) {
  const statusDot = STATUS_DOTS[source.status] ?? 'bg-gray-400';

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all',
        isSelected
          ? 'bg-primary/8 shadow-sm'
          : 'hover:bg-accent/50',
      )}
      onClick={onToggle}
    >
      {/* Left accent bar for selected items */}
      {isSelected && (
        <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />
      )}

      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 h-3.5 w-3.5"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
          <span className={cn(
            'truncate text-xs font-medium leading-tight',
            isSelected && 'text-foreground',
          )}>
            {source.title}
          </span>
          {source.visibility === 'org' && (
            <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatNumber(source.postsCollected)} posts
          </span>
          <span className="text-[10px] text-muted-foreground">
            {shortDate(source.createdAt)}
          </span>
        </div>

        {/* Platform icons */}
        <div className="flex items-center gap-1 mt-1">
          <TooltipProvider delayDuration={200}>
            {(source.config.platforms ?? []).slice(0, 4).map((p) => (
              <Tooltip key={p}>
                <TooltipTrigger asChild>
                  <div>
                    <PlatformIcon platform={p} className="h-3 w-3" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[10px]">{p}</TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      </div>

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewStats(); }}>
            <BarChart3 className="mr-2 h-3.5 w-3.5" /> View Stats
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDownload(); }}>
            <Download className="mr-2 h-3.5 w-3.5" /> Download CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
