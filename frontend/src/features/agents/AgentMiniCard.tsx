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
import { cn } from '../../lib/utils.ts';

interface TaskMiniCardProps {
  task: Agent;
}

function MiniThumbnail({ collectionIds }: { collectionIds: string[] }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

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
  const url = posts
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
[0];

  return (
    <div className="flex h-16 items-center justify-center bg-muted/20 overflow-hidden relative">
      {(!loaded || errored) && <Logo size="sm" showText className="opacity-20 absolute" />}
      {url && !errored && (
        <img
          src={url}
          alt=""
          className={cn('h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
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
      className="flex w-[240px] shrink-0 flex-col rounded-xl border bg-card overflow-hidden text-left transition-all hover:border-primary/30 hover:shadow-md"
    >
      <MiniThumbnail collectionIds={task.collection_ids} />

      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="line-clamp-2 text-sm font-medium leading-tight text-foreground">
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
