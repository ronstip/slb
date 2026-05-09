import { useMemo, useState } from 'react';
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
import { BotAvatar } from '../../components/BrandElements.tsx';
import { cn } from '../../lib/utils.ts';
import { toast } from 'sonner';
import type { FeedResponse } from '../../api/types.ts';

interface TaskCardProps {
  task: Agent;
  compact?: boolean;
  simple?: boolean;
  skipThumbnails?: boolean;
  onClick?: () => void;
}

// ── Tiny inline sparkline (~28 × 60 px) ──
//
// The chart is decorative and seeded from the agent_id so each card has
// a stable, distinct silhouette. It tints green for positive sentiment
// and red for negative.
function Sparkline({ seed, trend }: { seed: string; trend: 'up' | 'down' | 'flat' }) {
  const points = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
    const n = 12;
    const pts: number[] = [];
    let x = h;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      pts.push((x % 100) / 100);
    }
    // Bias the curve based on trend so the line visibly rises or falls.
    return pts.map((v, i) => {
      const bias = trend === 'up' ? i / n : trend === 'down' ? -i / n : 0;
      return Math.max(0, Math.min(1, 0.4 + 0.4 * v + 0.5 * bias));
    });
  }, [seed, trend]);

  const w = 60;
  const h = 22;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - v * (h - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke =
    trend === 'down' ? '#C25E3F' : trend === 'up' ? '#2F8E6C' : '#7E7666';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Subtitle / data-window line on the card ──
function describeDataWindow(task: Agent): string {
  if (task.schedule) {
    const f = task.schedule.frequency;
    if (f === 'hourly') return 'live hourly';
    if (f === 'daily') return 'rolling daily';
    if (f === 'weekly') return 'rolling weekly';
    if (f === 'monthly') return 'rolling monthly';
  }
  const sources = task.data_scope?.sources ?? [];
  if (sources.length > 0) {
    const days = Math.max(...sources.map((s) => s.time_range_days || 0));
    if (days > 0) return `${days}-day rolling`;
  }
  if (task.agent_type === 'recurring') return 'recurring window';
  return 'campaign window';
}

function formatCount(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

// ── Stats card — Mentions / Sentiment / Sparkline ──
function StatsRow({ task, data }: { task: Agent; data?: FeedResponse }) {
  const total = data?.total ?? 0;
  const sentiment = useMemo(() => {
    const posts = data?.posts ?? [];
    if (posts.length === 0) return null;
    const score = posts.reduce((acc, p) => {
      if (p.sentiment === 'positive') return acc + 1;
      if (p.sentiment === 'negative') return acc - 1;
      return acc;
    }, 0);
    if (score === 0) return null;
    // Scale up so the value reads as "+12" / "−3" — mirrors the design.
    const total = posts.length || 1;
    return Math.round((score / total) * 24);
  }, [data]);

  const sentimentLabel =
    sentiment === null
      ? '—'
      : sentiment > 0
        ? `+${sentiment}`
        : sentiment < 0
          ? `−${Math.abs(sentiment)}`
          : '0';
  const trend: 'up' | 'down' | 'flat' =
    sentiment === null ? 'flat' : sentiment > 0 ? 'up' : sentiment < 0 ? 'down' : 'flat';
  const sentimentColor =
    sentiment === null
      ? 'text-muted-foreground'
      : sentiment > 0
        ? 'text-[color:var(--color-accent-green)]'
        : sentiment < 0
          ? 'text-[color:var(--color-accent-vibrant)]'
          : 'text-muted-foreground';

  return (
    <div className="flex items-end justify-between gap-2">
      <div className="grid grid-cols-2 gap-x-4">
        <div className="flex flex-col">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
            Mentions
          </span>
          <span className="font-heading text-sm font-semibold tabular-nums text-foreground">
            {formatCount(total)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
            Sentiment
          </span>
          <span className={cn('font-heading text-sm font-semibold tabular-nums', sentimentColor)}>
            {sentimentLabel}
          </span>
        </div>
      </div>
      <Sparkline seed={task.agent_id} trend={trend} />
    </div>
  );
}

function ThumbnailGrid({
  data,
  compact,
  agentId,
}: {
  data?: FeedResponse;
  compact?: boolean;
  agentId: string;
}) {
  const heightClass = compact ? 'h-24' : 'h-32';
  const [imageStates, setImageStates] = useState<Record<string, 'loaded' | 'error'>>({});

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
      const url = mediaUrl(imageRef.gcs_uri, imageRef.original_url);
      if (!url) return [];
      return [url];
    })
    .slice(0, 3);

  const hasLoaded = candidates.some((url) => imageStates[url] === 'loaded');
  const [u1, u2, u3] = candidates;
  const avatarSize = compact ? 36 : 44;

  return (
    <div className="relative">
      <div className={cn('relative overflow-hidden bg-muted/40', heightClass)}>
        {!hasLoaded && (
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
      <div className="absolute -bottom-4 left-3 z-10 drop-shadow-sm">
        <BotAvatar seed={agentId} size={avatarSize} />
      </div>
    </div>
  );
}

export function AgentCard({ task, compact, simple, skipThumbnails, onClick }: TaskCardProps) {
  const navigate = useNavigate();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Single source of truth for the card's posts data — feeds both the
  // thumbnail collage and the Mentions / Sentiment stats footer.
  const collectionIds = task.collection_ids;
  const startDate = task.data_start_date;
  const endDate = task.data_end_date;
  const { data: feedData } = useQuery({
    queryKey: ['agent-thumbnails', collectionIds.join(','), startDate ?? '', endDate ?? '', task.agent_id],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: collectionIds,
        limit: 6,
        sort: 'engagement',
        has_media: true,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
        agent_id: task.agent_id,
      }),
    enabled: collectionIds.length > 0 && !skipThumbnails,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

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
  const subtitle = describeDataWindow(task);

  return (
    <>
      <div
        className={cn(
          'group relative flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-sm transition-all hover:border-primary/40 hover:shadow-md cursor-pointer',
          simple && 'min-h-[200px]',
        )}
        onClick={() => handleOpen()}
      >
        {!skipThumbnails && (
          <div className="relative">
            <ThumbnailGrid
              data={feedData}
              compact={compact}
              agentId={task.agent_id}
            />
            {/* Status badge — overlay on thumbnail top-right (simple mode only) */}
            {simple && (
              <div className="absolute right-2 top-2 z-20">
                <StatusBadge status={task.status} paused={task.paused} />
              </div>
            )}
          </div>
        )}

        <div className={cn('flex flex-1 flex-col', compact ? 'p-3 pt-6' : 'p-4 pt-7')}>
          {simple ? (
            <>
              <h3 className="line-clamp-2 font-heading text-sm font-semibold leading-snug tracking-tight text-foreground">
                {task.title}
              </h3>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {subtitle}
              </p>
              <div className="mt-3 flex-1" />
              <StatsRow task={task} data={feedData} />
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className={cn(
                  'line-clamp-2 font-heading font-semibold leading-tight tracking-tight text-foreground',
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
            </>
          )}

          {/* Actions */}
          {simple ? (
            /* Simple Figma-style footer: plain grey icons, no tooltips */
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-3">
                <button type="button" className="transition-colors hover:text-primary" onClick={handleOpenChat}>
                  <MessageSquare className="h-4 w-4" />
                </button>
                {hasArtifacts && (
                  <button type="button" className="transition-colors hover:text-primary" onClick={(e) => { e.stopPropagation(); navigate(`/agents/${task.agent_id}?tab=artifacts`); }}>
                    <FileText className="h-4 w-4" />
                  </button>
                )}
                {hasCollections && (
                  <button type="button" className="transition-colors hover:text-primary" onClick={(e) => { e.stopPropagation(); navigate(`/agents/${task.agent_id}?tab=explorer`); }}>
                    <Compass className="h-4 w-4" />
                  </button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="transition-colors hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
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
          ) : (
            /* Full action bar with tooltips */
            <div className={cn('flex items-center gap-1 mt-auto border-t', compact ? 'pt-2 mt-2' : 'pt-3 mt-3')} onClick={(e) => e.stopPropagation()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenChat}>
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
                  <TooltipContent>{task.agent_type === 'recurring' ? 'Run now' : 'Re-run'}</TooltipContent>
                </Tooltip>
              )}
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
              {hasArtifacts && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); navigate(`/agents/${task.agent_id}?tab=artifacts`); }}>
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Artifacts</TooltipContent>
                </Tooltip>
              )}
              {task.agent_type !== 'recurring' && task.status === 'success' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setScheduleOpen(true); }}>
                      <Timer className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Schedule</TooltipContent>
                </Tooltip>
              )}
              {hasCollections && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); navigate(`/agents/${task.agent_id}?tab=explorer`); }}>
                      <Compass className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Explorer</TooltipContent>
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
          )}
        </div>
      </div>

      {/* Archive confirmation dialog */}
      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading tracking-tight">Archive this agent?</AlertDialogTitle>
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
            <DialogTitle className="font-heading tracking-tight">Rename Agent</DialogTitle>
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
