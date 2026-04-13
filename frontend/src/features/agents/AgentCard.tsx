import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Compass,
  Database,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  StopCircle,
  Timer,
} from 'lucide-react';
import { ScheduleDialog } from './detail/ScheduleDialog.tsx';
import type { Agent } from '../../api/endpoints/agents.ts';
import { runAgent, updateAgent as patchAgent } from '../../api/endpoints/agents.ts';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { mediaUrl } from '../../api/client.ts';
import { StatusBadge, RUNNABLE_STATUSES, formatLastRun } from './AgentDetailDrawer.tsx';
import { formatSchedule } from '../../lib/constants.ts';
import { useAgentStore } from '../../stores/agent-store.ts';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
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
  // Prefer refs with gcs_uri (permanent), fall back to original_url (may expire but better than nothing)
  const candidates = posts
    .flatMap((p) => {
      const refs = p.media_refs ?? [];
      const imageRef =
        refs.find((r) => r.media_type === 'image' && r.gcs_uri) ??
        refs.find((r) => r.gcs_uri) ??
        refs.find((r) => r.media_type === 'image' && r.original_url) ??
        refs.find((r) => r.original_url);
      if (!imageRef) return [];
      const url = mediaUrl(imageRef.gcs_uri, imageRef.original_url);
      if (!url) return [];
      return [url];
    })
    .slice(0, maxImages);

  const hasLoaded = candidates.some((url) => imageStates[url] === 'loaded');

  return (
    <div className={cn('relative overflow-hidden', heightClass)}>
      {/* Logo — always rendered as background; hidden once an image loads */}
      {!hasLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/20">
          <Logo size="sm" showText className="opacity-20" />
        </div>
      )}

      {candidates.length > 0 && (
        <div className="grid grid-cols-3 gap-0.5 h-full">
          {candidates.map((url) => (
            <div key={url} className="relative overflow-hidden bg-muted/30">
              <img
                src={url}
                alt=""
                className={cn(
                  'h-full w-full object-cover transition-opacity duration-300',
                  imageStates[url] === 'loaded' ? 'opacity-100' : 'opacity-0',
                )}
                loading="lazy"
                referrerPolicy="no-referrer"
                onLoad={() => setImageStates((s) => ({ ...s, [url]: 'loaded' }))}
                onError={() => setImageStates((s) => ({ ...s, [url]: 'error' }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentCard({ task, compact, onClick }: TaskCardProps) {
  const navigate = useNavigate();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const handleOpen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onClick) {
      onClick();
      return;
    }
    navigate(`/agents/${task.agent_id}`);
  };

  const handleOpenChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/agents/${task.agent_id}?tab=chat`);
  };

  const handleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await runAgent(task.agent_id);
      toast.success('Agent run started');
      fetchAgents();
    } catch {
      toast.error('Failed to start agent run');
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await patchAgent(task.agent_id, { status: 'success' });
      toast.success('Agent stopped');
      fetchAgents();
    } catch {
      toast.error('Failed to stop agent');
    }
  };

  const handlePauseResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newPaused = !task.paused;
    try {
      await patchAgent(task.agent_id, { paused: newPaused } as Parameters<typeof patchAgent>[1]);
      fetchAgents();
    } catch {
      toast.error('Failed to update agent');
    }
  };

  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const handleArchive = async () => {
    try {
      await patchAgent(task.agent_id, { status: 'archived' });
      fetchAgents();
      toast.success('Agent archived');
    } catch {
      toast.error('Failed to archive agent');
    } finally {
      setArchiveConfirmOpen(false);
    }
  };

  const handleRestore = async () => {
    try {
      await patchAgent(task.agent_id, { status: 'success' });
      fetchAgents();
      toast.success('Agent restored');
    } catch {
      toast.error('Failed to restore agent');
    }
  };

  const handleRenameOpen = () => {
    setRenameValue(task.title);
    setRenameOpen(true);
  };

  const handleRenameSave = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === task.title) {
      setRenameOpen(false);
      return;
    }
    try {
      await patchAgent(task.agent_id, { title: trimmed });
      fetchAgents();
      toast.success('Agent renamed');
    } catch {
      toast.error('Failed to rename agent');
    } finally {
      setRenameOpen(false);
    }
  };

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'running';
  const hasArtifacts = (task.artifact_ids?.length ?? 0) > 0;
  const hasCollections = (task.collection_ids?.length ?? 0) > 0;

  return (
    <>
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
            <StatusBadge status={task.status} paused={task.paused} />
          </div>

          {/* Meta info — hidden in compact mode */}
          {!compact && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {task.collection_ids.length}
              </span>
              {hasArtifacts && (
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
          )}

          {!compact && (
            <div className="text-[11px] text-muted-foreground/60 mt-1">
              Last run: {formatLastRun(task.updated_at)}
            </div>
          )}

          {/* Actions */}
          <div className={cn(
            'flex items-center gap-1 mt-auto border-t',
            compact ? 'pt-2 mt-2' : 'pt-3 mt-3',
          )} onClick={(e) => e.stopPropagation()}>

            {/* Chat */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenChat}>
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Chat</TooltipContent>
            </Tooltip>

            {/* Run / Re-run */}
            {canRun && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRun}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{task.agent_type === 'recurring' ? 'Run now' : 'Re-run'}</TooltipContent>
              </Tooltip>
            )}

            {/* Stop */}
            {task.status === 'running' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={handleStop}>
                    <StopCircle className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
            )}

            {/* Pause / Resume */}
            {task.agent_type === 'recurring' && task.status !== 'running' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePauseResume}>
                    {!task.paused ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{!task.paused ? 'Pause' : 'Resume'}</TooltipContent>
              </Tooltip>
            )}

            {/* Artifacts */}
            {hasArtifacts && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/agents/${task.agent_id}?tab=artifacts`);
                  }}>
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Artifacts</TooltipContent>
              </Tooltip>
            )}

            {/* Schedule (one-time tasks that completed/approved) */}
            {task.agent_type !== 'recurring' && task.status === 'success' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                    e.stopPropagation();
                    setScheduleOpen(true);
                  }}>
                    <Timer className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Schedule</TooltipContent>
              </Tooltip>
            )}

            {/* Explorer */}
            {hasCollections && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/agents/${task.agent_id}?tab=explorer`);
                  }}>
                    <Compass className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Explorer</TooltipContent>
              </Tooltip>
            )}

            <div className="flex-1" />

            {/* Three-dot menu: management actions only */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={handleRenameOpen}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {task.status === 'archived' ? (
                  <DropdownMenuItem onClick={handleRestore}>
                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setArchiveConfirmOpen(true)}>
                    <Archive className="mr-2 h-3.5 w-3.5" />
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Archive confirmation dialog */}
      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              Any active data collection and scheduled runs will be stopped. You can restore the agent later from the archived filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule dialog */}
      <ScheduleDialog task={task} open={scheduleOpen} onOpenChange={setScheduleOpen} />

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Agent</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSave(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleRenameSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
