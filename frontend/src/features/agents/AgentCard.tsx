import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  Compass,
  Database,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  StopCircle,
  Trash2,
} from 'lucide-react';
import type { Agent } from '../../api/endpoints/agents.ts';
import { runAgent, deleteAgent, updateAgent as patchAgent } from '../../api/endpoints/agents.ts';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { mediaUrl } from '../../api/client.ts';
import { StatusBadge, RUNNABLE_STATUSES, formatLastRun } from './AgentDetailDrawer.tsx';
import { formatSchedule } from '../../lib/constants.ts';
import { useAgentStore } from '../../stores/agent-store.ts';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';
import { cn } from '../../lib/utils.ts';
import { toast } from 'sonner';

interface TaskCardProps {
  task: Agent;
  compact?: boolean;
  onClick?: () => void;
}

function ThumbnailGrid({ collectionIds, compact }: { collectionIds: string[]; compact?: boolean }) {
  const maxImages = compact ? 3 : 6;
  const heightClass = compact ? 'h-24' : 'h-32';
  const [erroredCount, setErroredCount] = useState(0);

  const { data, isPending } = useQuery({
    queryKey: ['agent-thumbnails', collectionIds.join(',')],
    queryFn: () => getMultiCollectionPosts({ collection_ids: collectionIds, limit: 8, sort: 'engagement' }),
    enabled: collectionIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Skeleton loading state
  if (isPending && collectionIds.length > 0) {
    return (
      <div className={cn('flex items-center justify-center bg-muted/30', heightClass)}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const posts = data?.posts ?? [];
  const images = posts
    .map((p) => {
      const ref = p.media_refs?.[0];
      if (!ref) return null;
      return mediaUrl(ref.gcs_uri, ref.original_url);
    })
    .filter(Boolean)
    .slice(0, maxImages) as string[];

  // Logo placeholder: no media at all, or every image URL failed to load
  if (images.length === 0 || erroredCount >= images.length) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-muted/20', heightClass)}>
        <Logo size="sm" showText className="opacity-20" />
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-3 gap-0.5 overflow-hidden', heightClass)}>
      {images.map((url, i) => (
        <div key={i} className="relative overflow-hidden bg-muted/30">
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              setErroredCount((c) => c + 1);
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function AgentCard({ task, compact, onClick }: TaskCardProps) {
  const navigate = useNavigate();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const handleOpen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onClick) {
      onClick();
      return;
    }
    navigate(`/tasks/${task.task_id}`);
  };

  const handleOpenSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sessionId = task.primary_session_id || task.session_id;
    if (sessionId) navigate(`/tasks/${task.task_id}?tab=chat`);
  };

  const handleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await runAgent(task.task_id);
      toast.success('Agent run started');
      fetchAgents();
    } catch {
      toast.error('Failed to start agent run');
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await patchAgent(task.task_id, { status: 'completed' });
      toast.success('Agent stopped');
      fetchAgents();
    } catch {
      toast.error('Failed to stop agent');
    }
  };

  const handlePauseResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = task.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchAgent(task.task_id, { status: newStatus });
      fetchAgents();
    } catch {
      toast.error('Failed to update agent');
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteAgent(task.task_id);
      fetchAgents();
      toast.success('Agent deleted');
    } catch {
      toast.error('Failed to delete agent');
    }
  };

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  return (
    <div
      className="group flex flex-col rounded-xl border bg-card overflow-hidden transition-all hover:border-primary/30 hover:shadow-md cursor-pointer"
      onClick={() => handleOpen()}
    >
      <ThumbnailGrid collectionIds={task.collection_ids} compact={compact} />

      <div className={cn('flex flex-1 flex-col', compact ? 'p-3' : 'p-4')}>
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className={cn(
            'line-clamp-2 font-semibold leading-tight text-foreground',
            compact ? 'text-xs' : 'text-sm',
          )}>
            {task.title}
          </h3>
          <StatusBadge status={task.status} />
        </div>

        {/* Meta info */}
        <div className={cn(
          'flex flex-wrap items-center gap-2 text-muted-foreground',
          compact ? 'text-[10px] gap-1.5' : 'text-[11px] gap-3',
        )}>
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            {task.collection_ids.length}
          </span>
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

        {!compact && (
          <div className="text-[11px] text-muted-foreground/60 mt-1">
            Last run: {formatLastRun(task.run_history)}
          </div>
        )}

        {/* Actions */}
        <div className={cn(
          'flex items-center gap-1 mt-auto border-t',
          compact ? 'pt-2 mt-2' : 'pt-3 mt-3',
        )} onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenSession}>
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>

          {canRun && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRun}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{task.task_type === 'recurring' ? 'Run now' : 'Re-run'}</TooltipContent>
            </Tooltip>
          )}

          {task.status === 'executing' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={handleStop}>
                  <StopCircle className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
          )}

          {task.task_type === 'recurring' && (task.status === 'monitoring' || task.status === 'paused') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePauseResume}>
                  {task.status === 'monitoring' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{task.status === 'monitoring' ? 'Pause' : 'Resume'}</TooltipContent>
            </Tooltip>
          )}

          {(task.collection_ids?.length ?? 0) > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/tasks/${task.task_id}?tab=explorer`);
                }}>
                  <Compass className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Explore data</TooltipContent>
            </Tooltip>
          )}

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => navigate(`/tasks/${task.task_id}`)}>
                View Details
              </DropdownMenuItem>
              {(task.collection_ids?.length ?? 0) > 0 && (
                <DropdownMenuItem onClick={() => navigate(`/tasks/${task.task_id}?tab=explorer`)}>
                  <Compass className="mr-2 h-3.5 w-3.5" />
                  Explore Data
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={(e) => handleDelete(e as unknown as React.MouseEvent)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
