import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getAgentTopics } from '../../../api/endpoints/topics.ts';
import { TopicCard } from '../../studio/TopicCard.tsx';

interface TopicsSectionCardProps {
  data: Record<string, unknown>;
}

const INITIAL_COUNT = 5;
const MIN_POSTS_PER_TOPIC = 5;

export function TopicsSectionCard({ data }: TopicsSectionCardProps) {
  const agentId = data.agent_id as string;
  const [showAll, setShowAll] = useState(false);

  const { data: topics, isLoading } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
  });

  if (!agentId) return null;

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
    );
  }

  if (!topics || topics.length === 0) return null;

  const filtered = topics.filter((t) => (t.post_count ?? 0) >= MIN_POSTS_PER_TOPIC);
  if (filtered.length === 0) return null;

  const sorted = [...filtered].sort((a, b) => {
    const va = (a.total_views && a.post_count) ? a.total_views / a.post_count : 0;
    const vb = (b.total_views && b.post_count) ? b.total_views / b.post_count : 0;
    return vb - va;
  });
  const visible = showAll ? sorted : sorted.slice(0, INITIAL_COUNT);
  const hasMore = sorted.length > INITIAL_COUNT;

  return (
    <div className="mt-3 space-y-2">
      {visible.map((topic, i) => (
        <TopicCard key={topic.cluster_id} topic={topic} agentId={agentId} rank={i + 1} />
      ))}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-border/50 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/50 transition-colors"
        >
          {showAll ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show {sorted.length - INITIAL_COUNT} more topics <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
