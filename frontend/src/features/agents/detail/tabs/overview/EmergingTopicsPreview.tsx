import { useQuery } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { getAgentTopics } from '../../../../../api/endpoints/topics.ts';
import type { TopicCluster } from '../../../../../api/types.ts';
import { formatNumber } from '../../../../../lib/format.ts';

interface EmergingTopicsPreviewProps {
  agentId: string;
  isAgentRunning: boolean;
  onOpenTopics: () => void;
}

export function EmergingTopicsPreview({
  agentId,
  isAgentRunning,
  onOpenTopics,
}: EmergingTopicsPreviewProps) {
  const { data: topics, isLoading } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
    refetchInterval: isAgentRunning ? 30_000 : false,
  });

  const items = topics ?? [];
  const preview = items.slice(0, 5);

  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Emerging topics</h3>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">{items.length} total</span>
          )}
        </div>
        {items.length > 0 && (
          <button
            onClick={onOpenTopics}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            View all →
          </button>
        )}
      </header>

      {isLoading && items.length === 0 ? (
        <TopicsSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Hash className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isAgentRunning
              ? 'Topics will emerge as posts are analyzed…'
              : 'No topics generated yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {preview.map((t) => (
            <TopicRow key={t.cluster_id} topic={t} onClick={onOpenTopics} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TopicRow({ topic, onClick }: { topic: TopicCluster; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-muted/40"
      >
        <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 group-hover:text-primary" />
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {topic.topic_name}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatNumber(topic.post_count)}
        </span>
      </button>
    </li>
  );
}

function TopicsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="relative h-7 overflow-hidden rounded-md bg-muted/40"
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
