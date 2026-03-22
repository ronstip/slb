import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getTopics } from '../../../api/endpoints/topics.ts';
import { TopicCard } from '../../studio/TopicCard.tsx';

interface TopicsSectionCardProps {
  data: Record<string, unknown>;
}

const INITIAL_COUNT = 5;

export function TopicsSectionCard({ data }: TopicsSectionCardProps) {
  const collectionId = data.collection_id as string;
  const [showAll, setShowAll] = useState(false);

  const { data: topics, isLoading } = useQuery({
    queryKey: ['topics', collectionId],
    queryFn: () => getTopics(collectionId),
    enabled: !!collectionId,
  });

  if (!collectionId) return null;

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

  const visible = showAll ? topics : topics.slice(0, INITIAL_COUNT);
  const hasMore = topics.length > INITIAL_COUNT;

  return (
    <div className="mt-3 space-y-2">
      {visible.map((topic, i) => (
        <TopicCard key={topic.cluster_id} topic={topic} collectionId={collectionId} rank={i + 1} />
      ))}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-border/50 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary/50 transition-colors"
        >
          {showAll ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show {topics.length - INITIAL_COUNT} more topics <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
