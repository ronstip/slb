import type { FeedParams } from '../../api/types.ts';
import { formatNumber } from '../../lib/format.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';

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
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/70">
          {formatNumber(totalCount)} posts
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={sort} onValueChange={(v) => onSortChange(v as FeedParams['sort'])}>
          <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="engagement">Engagement</SelectItem>
            <SelectItem value="recent">Most Recent</SelectItem>
            <SelectItem value="sentiment">Sentiment</SelectItem>
          </SelectContent>
        </Select>

        <Select value={platform} onValueChange={onPlatformChange}>
          <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="twitter">Twitter/X</SelectItem>
            <SelectItem value="reddit">Reddit</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sentiment} onValueChange={onSentimentChange}>
          <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sentiment</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="mixed">Mixed</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
