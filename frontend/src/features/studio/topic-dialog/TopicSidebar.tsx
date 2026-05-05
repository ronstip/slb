import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import type { TopicCluster } from '../../../api/types.ts';
import { viralityScore } from '../topic-helpers.ts';
import { TopicMiniCard } from './TopicMiniCard.tsx';

export type TopicSortKey = 'virality' | 'posts' | 'recency' | 'positive' | 'negative';

const SORT_LABELS: Record<TopicSortKey, string> = {
  virality: 'Virality',
  posts: 'Post count',
  recency: 'Most recent',
  positive: 'Most positive',
  negative: 'Most negative',
};

function sortValue(topic: TopicCluster, key: TopicSortKey): number {
  switch (key) {
    case 'virality':
      return viralityScore(topic) ?? -1;
    case 'posts':
      return topic.post_count ?? 0;
    case 'recency':
      return topic.recency_score ?? 0;
    case 'positive': {
      const pos = topic.positive_count ?? 0;
      const total =
        (topic.positive_count ?? 0) +
        (topic.negative_count ?? 0) +
        (topic.neutral_count ?? 0) +
        (topic.mixed_count ?? 0);
      return total > 0 ? pos / total : -1;
    }
    case 'negative': {
      const neg = topic.negative_count ?? 0;
      const total =
        (topic.positive_count ?? 0) +
        (topic.negative_count ?? 0) +
        (topic.neutral_count ?? 0) +
        (topic.mixed_count ?? 0);
      return total > 0 ? neg / total : -1;
    }
  }
}

interface TopicSidebarProps {
  topics: TopicCluster[];
  selectedClusterId: string;
  onSelect: (clusterId: string) => void;
  sortKey: TopicSortKey;
  onSortChange: (key: TopicSortKey) => void;
}

export function TopicSidebar({
  topics,
  selectedClusterId,
  onSelect,
  sortKey,
  onSortChange,
}: TopicSidebarProps) {
  const sorted = useMemo(() => {
    return [...topics].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
  }, [topics, sortKey]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card">
      <div className="border-b border-border/60 px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-heading text-sm font-semibold text-foreground">Topics</h3>
          <span className="text-[10px] tabular-nums text-muted-foreground">{topics.length}</span>
        </div>
        <Select value={sortKey} onValueChange={(v) => onSortChange(v as TopicSortKey)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as TopicSortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {sorted.map((topic) => (
            <li key={topic.cluster_id}>
              <TopicMiniCard
                topic={topic}
                selected={topic.cluster_id === selectedClusterId}
                onSelect={() => onSelect(topic.cluster_id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
