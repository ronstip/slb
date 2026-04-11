import { Download, Filter, Link2, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { PLATFORM_COLORS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';

interface PostsToolbarProps {
  search: string;
  onSearchChange: (s: string) => void;
  onFeedLink: () => void;
  onExportCsv: () => void;
  totalPosts: number;
  hasSelection: boolean;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  stats: {
    platforms: Record<string, number>;
    sentiments: Record<string, number>;
    avgViews: number;
    avgLikes: number;
    totalPosts: number;
  } | null;
}

export function PostsToolbar({
  search,
  onSearchChange,
  onFeedLink,
  onExportCsv,
  totalPosts,
  hasSelection,
  hasActiveFilters,
  onClearFilters,
  stats,
}: PostsToolbarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-card px-4 py-2">
      {/* Search */}
      <div className="relative w-56">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search all posts..."
          className="h-8 pl-8 text-xs bg-white dark:bg-background"
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

      {/* Clear all column filters */}
      {hasActiveFilters && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11px] border-primary/30 text-primary hover:bg-primary/5"
          onClick={onClearFilters}
        >
          <Filter className="h-3 w-3" />
          Clear Filters
          <X className="h-3 w-3" />
        </Button>
      )}

      {/* Separator */}
      <div className="h-4 w-px bg-border" />

      {/* Inline stats */}
      {stats && (
        <>
          {/* Post count */}
          <span className="text-[11px] text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{totalPosts.toLocaleString()}</span> posts
          </span>

          {/* Platform mini-badges */}
          <div className="flex items-center gap-1">
            {Object.entries(stats.platforms)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([platform, count]) => (
                <span
                  key={platform}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                  style={{
                    color: PLATFORM_COLORS[platform] ?? '#6B7294',
                    backgroundColor: `${PLATFORM_COLORS[platform] ?? '#6B7294'}15`,
                  }}
                >
                  {platform} {count}
                </span>
              ))}
          </div>

          {/* Sentiment bar */}
          <div className="flex items-center gap-1.5">
            <div className="flex h-2 w-24 overflow-hidden rounded-full bg-muted/60">
              {['positive', 'neutral', 'mixed', 'negative'].map((s) => {
                const count = stats.sentiments[s] ?? 0;
                const pct = stats.totalPosts > 0 ? (count / stats.totalPosts) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div
                    key={s}
                    className="h-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: SENTIMENT_COLORS[s] }}
                    title={`${s}: ${count} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
          </div>

          {/* Avg metrics */}
          <span className="text-[10px] text-muted-foreground">
            avg <span className="font-semibold text-foreground tabular-nums">{formatNumber(stats.avgViews)}</span> views
          </span>
          <span className="text-[10px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{formatNumber(stats.avgLikes)}</span> likes
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Actions */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-[11px]"
        onClick={onFeedLink}
        disabled={!hasSelection}
      >
        <Link2 className="h-3 w-3" />
        Feed Link
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-[11px]"
        onClick={onExportCsv}
        disabled={!hasSelection}
      >
        <Download className="h-3 w-3" />
        Export CSV
      </Button>
    </div>
  );
}
