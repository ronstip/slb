import type { FeedParams } from '../../api/types.ts';
import { formatNumber } from '../../lib/format.ts';

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
    <div className="flex flex-col gap-2 border-b border-border-default/60 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {formatNumber(totalCount)} posts
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as FeedParams['sort'])}
          className="rounded-lg border border-border-default/60 bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
        >
          <option value="engagement">Engagement</option>
          <option value="recent">Most Recent</option>
          <option value="sentiment">Sentiment</option>
        </select>
        <select
          value={platform}
          onChange={(e) => onPlatformChange(e.target.value)}
          className="rounded-lg border border-border-default/60 bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
        >
          <option value="all">All Platforms</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="twitter">Twitter/X</option>
          <option value="reddit">Reddit</option>
          <option value="youtube">YouTube</option>
        </select>
        <select
          value={sentiment}
          onChange={(e) => onSentimentChange(e.target.value)}
          className="rounded-lg border border-border-default/60 bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
        >
          <option value="all">All Sentiment</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="neutral">Neutral</option>
          <option value="mixed">Mixed</option>
        </select>
      </div>
    </div>
  );
}
