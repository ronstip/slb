import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog.tsx';
import { getAgentTopics } from '../../../api/endpoints/topics.ts';
import { TopicSidebar, type TopicSortKey } from './TopicSidebar.tsx';
import { TopicHero } from './TopicHero.tsx';

const MIN_POSTS_FOR_DIALOG = 3;

interface TopicDialogProps {
  agentId: string;
  initialClusterId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TopicDialog({
  agentId,
  initialClusterId,
  open,
  onOpenChange,
}: TopicDialogProps) {
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(initialClusterId);
  const [sortKey, setSortKey] = useState<TopicSortKey>('virality');

  const { data: rawTopics } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId && open,
    staleTime: 5 * 60_000,
  });

  const topics = useMemo(
    () => (rawTopics ?? []).filter((t) => (t.post_count ?? 0) >= MIN_POSTS_FOR_DIALOG),
    [rawTopics],
  );

  useEffect(() => {
    if (open) setSelectedClusterId(initialClusterId);
  }, [open, initialClusterId]);

  const selected = topics.find((t) => t.cluster_id === selectedClusterId) ?? topics[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[95vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <DialogTitle className="sr-only">
          {selected ? selected.topic_name : 'Topics'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {selected?.topic_summary ?? 'Browse topics with examples and analytics.'}
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-1">
          <TopicSidebar
            topics={topics}
            selectedClusterId={selected?.cluster_id ?? ''}
            onSelect={setSelectedClusterId}
            sortKey={sortKey}
            onSortChange={setSortKey}
          />
          {selected ? (
            <TopicHero key={selected.cluster_id} topic={selected} agentId={agentId} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No topic selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
