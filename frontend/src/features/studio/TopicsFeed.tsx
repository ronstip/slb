import { useQuery } from '@tanstack/react-query';
import { getTopics } from '../../api/endpoints/topics.ts';
import { TopicCard } from './TopicCard.tsx';

interface TopicsFeedProps {
  collectionIds: string[];
  onViewPosts?: (clusterId: string, topicName: string) => void;
}

export function TopicsFeed({ collectionIds, onViewPosts }: TopicsFeedProps) {
  // For now, show topics for the first active collection
  // (topics are per-collection scoped)
  const collectionId = collectionIds[0];

  const { data: topics, isLoading, isError } = useQuery({
    queryKey: ['topics', collectionId],
    queryFn: () => getTopics(collectionId),
    enabled: !!collectionId,
  });

  if (!collectionId) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">
          Select a collection to view topics.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 px-3 pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Failed to load topics.
      </p>
    );
  }

  if (!topics || topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-muted-foreground">
          No topics generated yet. Topics are created automatically after embedding completes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 pt-4 pb-4 overflow-y-auto">
      <p className="text-[11px] text-muted-foreground/50 px-1">
        {topics.length} topics
      </p>
      {topics.map((topic) => (
        <TopicCard key={topic.cluster_id} topic={topic} collectionId={collectionId} onViewPosts={onViewPosts} />
      ))}
    </div>
  );
}
