import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getAgentTopics } from '../../api/endpoints/topics.ts';
import { Button } from '../../components/ui/button.tsx';
import { TopicCard } from './TopicCard.tsx';
import { TopicsRegenerateDialog } from './TopicsRegenerateDialog.tsx';

interface TopicsFeedProps {
  agentId: string;
  onViewPosts?: (clusterId: string, topicName: string) => void;
  onTopicCount?: (count: number) => void;
}

export function TopicsFeed({ agentId, onViewPosts, onTopicCount }: TopicsFeedProps) {
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const { data: topics, isLoading, isError } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  // Report topic count to parent
  useEffect(() => {
    if (topics) onTopicCount?.(topics.length);
  }, [topics, onTopicCount]);

  if (!agentId) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">
          No agent selected.
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
      <>
        <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-3">
          <p className="text-sm text-muted-foreground">
            No topics generated yet. Topics are created automatically after embedding completes,
            or you can regenerate now.
          </p>
          <Button size="sm" variant="outline" onClick={() => setRegenerateOpen(true)}>
            <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Regenerate
          </Button>
        </div>
        <TopicsRegenerateDialog
          agentId={agentId}
          open={regenerateOpen}
          onOpenChange={setRegenerateOpen}
        />
      </>
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
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-foreground"
          onClick={() => setRegenerateOpen(true)}
          title="Regenerate topics"
        >
          <RotateCw className="h-3 w-3 mr-1" />
          Regenerate
        </Button>
      </div>
      {topTopics.map((topic) => (
        <TopicCard key={topic.cluster_id} topic={topic} agentId={agentId} onViewPosts={onViewPosts} />
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
          {otherTopics.map((topic) => (
            <TopicCard key={topic.cluster_id} topic={topic} agentId={agentId} onViewPosts={onViewPosts} />
          ))}
        </>
      )}

      <TopicsRegenerateDialog
        agentId={agentId}
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
      />
    </div>
  );
}
