import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Database, FileText, CalendarClock } from 'lucide-react';
import type { Agent } from '../../api/endpoints/agents.ts';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { mediaUrl } from '../../api/client.ts';
import { StatusBadge } from './AgentDetailDrawer.tsx';
import { formatSchedule } from '../../lib/constants.ts';
import { Logo } from '../../components/Logo.tsx';
import { BotAvatar } from '../../components/BrandElements.tsx';
import { cn } from '../../lib/utils.ts';

interface TaskMiniCardProps {
  task: Agent;
}

function MiniThumbnail({ collectionIds, agentId }: { collectionIds: string[]; agentId: string }) {
  const [imageStates, setImageStates] = useState<Record<string, 'loaded' | 'error'>>({});

  const { data } = useQuery({
    queryKey: ['agent-thumbnails', collectionIds.join(',')],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: collectionIds,
        limit: 6,
        sort: 'engagement',
        has_media: true,
      }),
    enabled: collectionIds.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const posts = data?.posts ?? [];
  const candidates = posts
    .flatMap((p) => {
      const refs = p.media_refs ?? [];
      const imageRef =
        refs.find((r) => r.media_type === 'image' && r.gcs_uri) ??
        refs.find((r) => r.gcs_uri) ??
        refs.find((r) => r.media_type === 'image' && r.original_url) ??
        refs.find((r) => r.original_url);
      if (!imageRef) return [];
      const u = mediaUrl(imageRef.gcs_uri, imageRef.original_url);
      if (!u) return [];
      return [u];
    })
    .slice(0, 3);

  const hasAnyLoaded = candidates.some((u) => imageStates[u] === 'loaded');
  const [u1, u2, u3] = candidates;

  return (
    <div className="relative">
      <div className="h-28 bg-muted/20 relative overflow-hidden">
        {!hasAnyLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Logo size="sm" showText className="opacity-20" />
          </div>
        )}
        {u1 && (
          <div className="flex h-full">
            <div className="w-1/2 h-full border-r border-background/50 overflow-hidden">
              <img
                src={u1}
                alt=""
                className={cn('h-full w-full object-cover transition-opacity duration-300', imageStates[u1] === 'loaded' ? 'opacity-100' : 'opacity-0')}
                loading="lazy"
                referrerPolicy="no-referrer"
                onLoad={() => setImageStates((s) => ({ ...s, [u1]: 'loaded' }))}
                onError={() => setImageStates((s) => ({ ...s, [u1]: 'error' }))}
              />
            </div>
            <div className="w-1/2 h-full flex flex-col">
              <div className="h-1/2 border-b border-background/50 overflow-hidden">
                <img
                  src={u2 ?? u1}
                  alt=""
                  className={cn('h-full w-full object-cover transition-opacity duration-300', imageStates[u2 ?? u1] === 'loaded' ? 'opacity-100' : 'opacity-0')}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onLoad={() => setImageStates((s) => ({ ...s, [u2 ?? u1]: 'loaded' }))}
                  onError={() => setImageStates((s) => ({ ...s, [u2 ?? u1]: 'error' }))}
                />
              </div>
              <div className="h-1/2 overflow-hidden">
                <img
                  src={u3 ?? u1}
                  alt=""
                  className={cn('h-full w-full object-cover transition-opacity duration-300', imageStates[u3 ?? u1] === 'loaded' ? 'opacity-100' : 'opacity-0')}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onLoad={() => setImageStates((s) => ({ ...s, [u3 ?? u1]: 'loaded' }))}
                  onError={() => setImageStates((s) => ({ ...s, [u3 ?? u1]: 'error' }))}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="absolute -bottom-4 left-3 z-10 rounded-lg border-2 border-card">
        <BotAvatar seed={agentId} size={32} />
      </div>
    </div>
  );
}

export function AgentMiniCard({ task }: TaskMiniCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/agents/${task.agent_id}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card overflow-hidden text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
    >
      <MiniThumbnail collectionIds={task.collection_ids} agentId={task.agent_id} />

      <div className="p-3 pt-6">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="line-clamp-2 font-heading text-sm font-semibold tracking-tight leading-tight text-foreground">
            {task.title}
          </h4>
        </div>

        <StatusBadge status={task.status} />

        <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-3 text-[11px] text-muted-foreground">
          {task.collection_ids.length > 0 && (
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              {task.collection_ids.length}
            </span>
          )}
          {task.artifact_ids.length > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {task.artifact_ids.length}
            </span>
          )}
          {task.schedule && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {formatSchedule(task.schedule.frequency)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
