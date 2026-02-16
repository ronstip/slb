import { SlidersHorizontal } from 'lucide-react';
import type { FeedParams } from '../../api/types.ts';
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
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { Button } from '../../components/ui/button.tsx';

interface FeedControlsProps {
  sort: FeedParams['sort'];
  platform: string;
  sentiment: string;
  onSortChange: (sort: FeedParams['sort']) => void;
  onPlatformChange: (platform: string) => void;
  onSentimentChange: (sentiment: string) => void;
  totalCount: number;
}

export function FeedControls({
  sort,
  platform,
  sentiment,
  onSortChange,
  onPlatformChange,
  onSentimentChange,
  totalCount,
}: FeedControlsProps) {
  const hasActiveFilter = platform !== 'all' || sentiment !== 'all';

  return (
    <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
      {/* Sort dropdown */}
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

      {/* Filter dropdown button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="relative h-6 gap-1 px-2 text-[11px] text-muted-foreground">
            <SlidersHorizontal className="h-3 w-3" />
            Filter
            {hasActiveFilter && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
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
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Post count */}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
        {formatNumber(totalCount)}
      </span>
    </div>
  );
}
