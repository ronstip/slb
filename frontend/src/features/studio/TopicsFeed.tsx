import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTopics } from '../../api/endpoints/topics.ts';
import { TopicCard } from './TopicCard.tsx';

interface TopicsFeedProps {
  collectionIds: string[];
  onViewPosts?: (clusterId: string, topicName: string) => void;
  onTopicCount?: (count: number) => void;
}

export function TopicsFeed({ collectionIds, onViewPosts, onTopicCount }: TopicsFeedProps) {
  // For now, show topics for the first active collection
  // (topics are per-collection scoped)
  const collectionId = collectionIds[0];

  const { data: topics, isLoading, isError } = useQuery({
    queryKey: ['topics', collectionId],
    queryFn: () => getTopics(collectionId),
    enabled: !!collectionId,
  });

  // Report topic count to parent
  useEffect(() => {
    if (topics) onTopicCount?.(topics.length);
  }, [topics, onTopicCount]);

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

  const TOP_N = 5;
  const topTopics = topics.slice(0, TOP_N);
  const otherTopics = topics.slice(TOP_N);

  return (
    <div className="flex flex-col gap-2.5 px-2.5 pt-3 pb-4">
      <div className="flex items-center gap-2 px-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
          Top {Math.min(TOP_N, topics.length)} topics
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {topTopics.map((topic, i) => (
        <TopicCard key={topic.cluster_id} topic={topic} collectionId={collectionId} rank={i + 1} onViewPosts={onViewPosts} />
      ))}

      {otherTopics.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-1 pt-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              More topics
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {otherTopics.map((topic, i) => (
            <TopicCard key={topic.cluster_id} topic={topic} collectionId={collectionId} rank={TOP_N + i + 1} onViewPosts={onViewPosts} />
          ))}
        </>
      )}
    </div>
  );
}
