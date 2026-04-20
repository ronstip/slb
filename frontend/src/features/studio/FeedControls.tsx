import { SlidersHorizontal } from 'lucide-react';
import type { FeedParams } from '../../api/types.ts';
import type { Source } from '../../stores/sources-store.ts';
import { formatNumber } from '../../lib/format.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { Button } from '../../components/ui/button.tsx';

export type FeedViewMode = 'posts' | 'topics';

interface FeedControlsProps {
  sort: FeedParams['sort'];
  platform: string;
  sentiment: string;
  relevantToTask: string;
  onSortChange: (sort: FeedParams['sort']) => void;
  onPlatformChange: (platform: string) => void;
  onSentimentChange: (sentiment: string) => void;
  onRelevantToTaskChange: (value: string) => void;
  totalCount: number;
  topicCount?: number;
  activeSources: Source[];
  collectionFilter: string[];
  onCollectionFilterChange: (ids: string[]) => void;
  viewMode: FeedViewMode;
  onViewModeChange: (mode: FeedViewMode) => void;
}

export function FeedControls({
  sort,
  platform,
  sentiment,
  relevantToTask,
  onSortChange,
  onPlatformChange,
  onSentimentChange,
  onRelevantToTaskChange,
  totalCount,
  topicCount,
  activeSources,
  collectionFilter,
  onCollectionFilterChange,
  viewMode,
  onViewModeChange,
}: FeedControlsProps) {
  const hasActiveFilter =
    platform !== 'all' ||
    sentiment !== 'all' ||
    relevantToTask !== 'true' ||
    collectionFilter.length > 0;

  function isCollectionShown(id: string) {
    return collectionFilter.length === 0 || collectionFilter.includes(id);
  }

  function toggleCollection(id: string) {
    if (collectionFilter.length === 0) {
      // Currently all shown — uncheck means show everyone except this one
      onCollectionFilterChange(
        activeSources.map((s) => s.collectionId).filter((cid) => cid !== id),
      );
    } else if (collectionFilter.includes(id)) {
      const next = collectionFilter.filter((cid) => cid !== id);
      // If last one unchecked, reset to all
      onCollectionFilterChange(next.length === 0 ? [] : next);
    } else {
      const next = [...collectionFilter, id];
      // If all are now checked, reset to all
      onCollectionFilterChange(next.length === activeSources.length ? [] : next);
    }
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
      {/* View mode toggle */}
      <div className="flex h-6 rounded-md bg-secondary p-0.5 text-[11px]">
        <button
          className={`rounded px-2 transition-colors ${viewMode === 'posts' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onViewModeChange('posts')}
        >
          Posts
        </button>
        <button
          className={`rounded px-2 transition-colors ${viewMode === 'topics' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onViewModeChange('topics')}
        >
          Topics
        </button>
      </div>

      {viewMode === 'posts' && (
        <>
          {/* Sort */}
          <Select value={sort} onValueChange={(v) => onSortChange(v as FeedParams['sort'])}>
            <SelectTrigger className="h-6 w-auto min-w-0 gap-1 px-2 text-[11px]">
              <span className="text-muted-foreground/60">Sort:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="views">Most Viewed</SelectItem>
              <SelectItem value="engagement">Engagement</SelectItem>
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="sentiment">Sentiment</SelectItem>
            </SelectContent>
          </Select>

          {/* Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              >
                <SlidersHorizontal className="h-3 w-3" />
                Filter
                {hasActiveFilter && (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-vibrant" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {/* Collection filter — only when 2+ active */}
              {activeSources.length >= 2 && (
                <>
                  <DropdownMenuLabel className="text-[10px]">Collection</DropdownMenuLabel>
                  {activeSources.map((src) => (
                    <DropdownMenuCheckboxItem
                      key={src.collectionId}
                      checked={isCollectionShown(src.collectionId)}
                      onCheckedChange={() => toggleCollection(src.collectionId)}
                      className="text-[11px]"
                    >
                      <span className="truncate">{src.title}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuLabel className="text-[10px]">Platform</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={platform} onValueChange={onPlatformChange}>
                <DropdownMenuRadioItem value="all">All Platforms</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="instagram">Instagram</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="tiktok">TikTok</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="twitter">Twitter/X</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="reddit">Reddit</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="youtube">YouTube</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px]">Sentiment</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sentiment} onValueChange={onSentimentChange}>
                <DropdownMenuRadioItem value="all">All Sentiment</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="positive">Positive</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="negative">Negative</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="neutral">Neutral</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="mixed">Mixed</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px]">Relevant to task</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={relevantToTask} onValueChange={onRelevantToTaskChange}>
                <DropdownMenuRadioItem value="true">Relevant only</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="false">Not relevant only</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Count */}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
        {viewMode === 'topics'
          ? topicCount != null ? `${topicCount} topics` : ''
          : formatNumber(totalCount)}
      </span>
    </div>
  );
}
