import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Compass,
  FileText,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Radio,
  Repeat,
  StopCircle,
  Table2,
} from 'lucide-react';
import type { Agent, AgentStatus, AgentLogEntry } from '../../api/endpoints/agents.ts';
import { getAgent, runAgent, updateAgent as patchAgent, getAgentArtifacts, getAgentLogs } from '../../api/endpoints/agents.ts';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import type { Source } from '../../stores/sources-store.ts';
import type { CollectionConfig } from '../../api/types.ts';
import type { ArtifactListItem } from '../../api/endpoints/artifacts.ts';
import { ARTIFACT_STYLES } from '../artifacts/artifact-utils.ts';
import { CollectionProgressCard } from '../chat/cards/CollectionProgressCard.tsx';
import { StatsModal } from '../sources/StatsModal.tsx';
import { TableModal } from '../sources/TableModal.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';
import {
  formatSchedule,
  buildScheduleFromPreset,
  parseToPreset,
  SCHEDULE_UTC_TIMES,
} from '../../lib/constants.ts';
import type { SchedulePreset } from '../../lib/constants.ts';

// --- Shared exports (used by AgentsPage table too) ---

export const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  approved: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Approved', color: 'text-blue-500' },
  executing: { icon: <Play className="h-3 w-3" />, label: 'Running', color: 'text-amber-500' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', color: 'text-green-500' },
  monitoring: { icon: <Radio className="h-3 w-3" />, label: 'Monitoring', color: 'text-violet-500' },
  paused: { icon: <Pause className="h-3 w-3" />, label: 'Paused', color: 'text-muted-foreground' },
  archived: { icon: <Archive className="h-3 w-3" />, label: 'Archived', color: 'text-muted-foreground' },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.approved;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export const RUNNABLE_STATUSES: AgentStatus[] = ['completed', 'monitoring', 'paused', 'approved', 'executing'];

export function formatLastRun(runHistory: Agent['run_history']): string {
  if (!runHistory?.length) return '—';
  const lastRunAt = runHistory[runHistory.length - 1]?.run_at;
  if (!lastRunAt) return '—';
  const d = new Date(lastRunAt);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- Internal helpers ---

const STATUS_ACCENT: Record<string, string> = {
  approved: 'bg-blue-500',
  executing: 'bg-amber-500',
  completed: 'bg-green-500',
  monitoring: 'bg-violet-500',
  paused: 'bg-muted-foreground/50',
  archived: 'bg-muted-foreground/30',
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLogTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildSourceForCollection(collectionId: string): Source {
  const stored = useSourcesStore.getState().sources.find((s) => s.collectionId === collectionId);
  if (stored) return stored;
  return {
    collectionId,
    status: 'completed',
    config: { platforms: [], keywords: [], channel_urls: [], time_range: { start: '', end: '' }, include_comments: false, geo_scope: 'global' } as CollectionConfig,
    title: collectionId.slice(0, 8),
    postsCollected: 0,
    totalViews: 0,
    positivePct: null,
    selected: false,
    active: false,
    createdAt: '',
  };
}

// --- Main component ---

export function AgentDetailDrawer({ task, open, onOpenChange, autoOpenSchedule, onExploreData }: {
  task: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoOpenSchedule?: boolean;
  onExploreData?: (task: Agent) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [statsCollectionId, setStatsCollectionId] = useState<string | null>(null);
  const [tableCollectionId, setTableCollectionId] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editPreset, setEditPreset] = useState<SchedulePreset>('daily');
  const [editTime, setEditTime] = useState('09:00');
  const [editRunNow, setEditRunNow] = useState(true);
  const [isPauseToggling, setIsPauseToggling] = useState(false);

  const handleOpenScheduleDialog = () => {
    if (displayTask?.schedule) {
      const { preset, time } = parseToPreset(displayTask.schedule.frequency);
      setEditPreset(preset);
      setEditTime(time);
      setEditRunNow(false);
    } else {
      setEditPreset('daily');
      setEditTime('09:00');
      setEditRunNow(true);
    }
    setScheduleDialogOpen(true);
  };

  // Auto-open schedule dialog when requested from table action
  useEffect(() => {
    if (autoOpenSchedule && open && task) {
      handleOpenScheduleDialog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSchedule, open, task?.task_id]);

  // Live refresh while task is executing
  const { data: freshTask } = useQuery({
    queryKey: ['agent-detail', task?.task_id],
    queryFn: () => getAgent(task!.task_id),
    enabled: open && !!task?.task_id,
    refetchInterval: (query) => {
      const s = query.state.data?.status ?? task?.status;
      return s === 'executing' ? 10_000 : false;
    },
  });
  const displayTask = freshTask ?? task;

  // Artifacts for this agent
  const { data: artifacts } = useQuery({
    queryKey: ['agent-artifacts', task?.task_id],
    queryFn: () => getAgentArtifacts(task!.task_id),
    enabled: open && !!task?.task_id && (task?.artifact_ids?.length ?? 0) > 0,
  });

  // Activity logs
  const { data: logs } = useQuery({
    queryKey: ['agent-logs', task?.task_id],
    queryFn: () => getAgentLogs(task!.task_id),
    enabled: open && !!task?.task_id,
    refetchInterval: () => {
      const s = displayTask?.status;
      return s === 'executing' ? 5_000 : false;
    },
  });

  if (!displayTask) return null;

  const collectionsCount = displayTask.collection_ids?.length || 0;
  const artifactsCount = displayTask.artifact_ids?.length || 0;

  const allCollectionIds = [...(displayTask.collection_ids || [])].reverse();
  const collectionsToShow = showAllCollections ? allCollectionIds : allCollectionIds.slice(0, 6);

  const sessionIds = displayTask.session_id
    ? [displayTask.session_id]
    : displayTask.session_ids?.length
      ? displayTask.session_ids
      : displayTask.primary_session_id
        ? [displayTask.primary_session_id]
        : [];

  const canRun = RUNNABLE_STATUSES.includes(displayTask.status);

  const handleRunDrawer = async () => {
    setIsRunning(true);
    try {
      await runAgent(displayTask.task_id);
      queryClient.invalidateQueries({ queryKey: ['agent-detail', displayTask.task_id] });
      fetchAgents();
    } catch {
      // 409 or other error — task may already be running
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await patchAgent(displayTask.task_id, { status: 'completed' });
      queryClient.invalidateQueries({ queryKey: ['agent-detail', displayTask.task_id] });
      fetchAgents();
    } catch {
      // ignore
    } finally {
      setIsStopping(false);
    }
  };

  const handleScheduleSave = async () => {
    const frequency = buildScheduleFromPreset(editPreset, editTime);
    try {
      const updates: Record<string, unknown> = {
        schedule: {
          frequency,
          frequency_label: formatSchedule(frequency),
          auto_report: false,
        },
      };
      if (displayTask.task_type !== 'recurring') {
        updates.task_type = 'recurring';
        updates.status = 'monitoring';
      }
      await patchAgent(displayTask.task_id, updates as Parameters<typeof patchAgent>[1]);
      if (editRunNow) {
        try { await runAgent(displayTask.task_id); } catch { /* 409 = already running */ }
      }
      queryClient.invalidateQueries({ queryKey: ['agent-detail', displayTask.task_id] });
      fetchAgents();
      setScheduleDialogOpen(false);
    } catch {
      // ignore
    }
  };

  const handlePauseResume = async () => {
    setIsPauseToggling(true);
    const newStatus = displayTask.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchAgent(displayTask.task_id, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['agent-detail', displayTask.task_id] });
      fetchAgents();
    } catch {
      // ignore
    } finally {
      setIsPauseToggling(false);
    }
  };

  // Timeline text
  const startDate = formatDate(displayTask.created_at);
  const endDate = displayTask.completed_at ? formatDate(displayTask.completed_at) : null;
  const timelineText = endDate
    ? `${startDate} \u2192 ${endDate}`
    : displayTask.status === 'executing'
      ? `${startDate} \u2014 Running`
      : displayTask.status === 'monitoring'
        ? `${startDate} \u2014 Monitoring`
        : startDate;

  // Logs display
  const allLogs = logs ?? [];
  const logsToShow = showAllLogs ? allLogs : allLogs.slice(0, 8);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[520px] sm:w-[600px] overflow-y-auto p-0">
        {/* Colored accent bar */}
        <div className={`h-1 w-full ${STATUS_ACCENT[displayTask.status] || 'bg-muted'}`} />

        <div className="px-6 pt-5 pb-6">
          <SheetHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={displayTask.status} />
              {displayTask.task_type === 'recurring' && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Repeat className="h-2.5 w-2.5" />recurring
                </Badge>
              )}
            </div>
            <SheetTitle className="text-lg leading-tight">{displayTask.title}</SheetTitle>
            <SheetDescription className="flex items-center gap-1.5 text-xs">
              <Clock className="h-3 w-3" />
              {timelineText}
            </SheetDescription>
          </SheetHeader>

          {/* Stats row */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <div className="text-xl font-bold">{collectionsCount}</div>
              <div className="text-[10px] text-muted-foreground">Collections</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <div className="text-xl font-bold">{artifactsCount}</div>
              <div className="text-[10px] text-muted-foreground">Artifacts</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <div className="text-xl font-bold">{displayTask.todos?.length || 0}</div>
              <div className="text-[10px] text-muted-foreground">Steps</div>
            </div>
          </div>

          {/* Schedule */}
          {displayTask.task_type === 'recurring' && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Schedule</h3>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {displayTask.schedule ? formatSchedule(displayTask.schedule.frequency) : 'No schedule'}
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleOpenScheduleDialog}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                </div>
                {displayTask.schedule?.auto_report && (
                  <div className="text-[10px] text-muted-foreground">Auto-report enabled</div>
                )}
                {displayTask.next_run_at && displayTask.status === 'monitoring' && (
                  <div className="text-xs text-muted-foreground">
                    Next run: {new Date(displayTask.next_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {new Date(displayTask.next_run_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                  </div>
                )}
                {/* Run History */}
                {displayTask.run_history && displayTask.run_history.length > 0 && (
                  <>
                    <div className="border-t pt-2 mt-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Run History</div>
                      <div className="space-y-1">
                        {displayTask.run_history.slice(-5).reverse().map((run, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div className={`h-1.5 w-1.5 rounded-full ${run.status === 'started' || run.status === 'completed' ? 'bg-green-500' : 'bg-amber-500'}`} />
                            <span>{formatDate(run.run_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            {sessionIds.length === 1 ? (
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/session/${sessionIds[0]}`);
                }}
              >
                <MessageSquare className="mr-1.5 h-3 w-3" />
                Open Conversation
              </Button>
            ) : sessionIds.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <MessageSquare className="mr-1.5 h-3 w-3" />
                    Conversations
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{sessionIds.length}</Badge>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {sessionIds.map((sid, i) => (
                    <DropdownMenuItem
                      key={sid}
                      onClick={() => {
                        onOpenChange(false);
                        navigate(`/session/${sid}`);
                      }}
                    >
                      {i === 0 ? 'Conversation' : `Conversation ${i + 1}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {displayTask.status === 'executing' && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStop}
                disabled={isStopping}
              >
                <StopCircle className="mr-1.5 h-3 w-3" />
                {isStopping ? 'Stopping\u2026' : 'Stop Task'}
              </Button>
            )}

            {canRun && displayTask.status !== 'executing' && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRunDrawer}
                disabled={isRunning}
              >
                {displayTask.task_type === 'recurring' ? (
                  <><Play className="mr-1.5 h-3 w-3" />Run Now</>
                ) : (
                  <><Repeat className="mr-1.5 h-3 w-3" />Re-run</>
                )}
              </Button>
            )}

            {displayTask.task_type === 'recurring' && (displayTask.status === 'monitoring' || displayTask.status === 'paused') && (
              <Button
                size="sm"
                variant="outline"
                onClick={handlePauseResume}
                disabled={isPauseToggling}
              >
                {displayTask.status === 'monitoring' ? (
                  <><Pause className="mr-1.5 h-3 w-3" />Pause</>
                ) : (
                  <><Play className="mr-1.5 h-3 w-3" />Resume</>
                )}
              </Button>
            )}

            {displayTask.task_type !== 'recurring' && ['completed', 'approved'].includes(displayTask.status) && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenScheduleDialog}
              >
                <CalendarClock className="mr-1.5 h-3 w-3" />
                Enable Schedule
              </Button>
            )}

            {(displayTask.collection_ids?.length ?? 0) > 0 && onExploreData && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onOpenChange(false); onExploreData(displayTask); }}
              >
                <Compass className="mr-1.5 h-3 w-3" />
                Explore Data
              </Button>
            )}
          </div>

          {/* Collections with Stats / Table buttons */}
          {collectionsCount > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Collections</h3>
              <div className="rounded-lg border overflow-hidden divide-y divide-border/40">
                {collectionsToShow.map((cid) => (
                  <div key={cid} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <CollectionProgressCard collectionId={cid} variant="inline" />
                    </div>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => setStatsCollectionId(cid)}
                          >
                            <BarChart3 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Statistics</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => setTableCollectionId(cid)}
                          >
                            <Table2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Data Table</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ))}
              </div>
              {allCollectionIds.length > 6 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setShowAllCollections((v) => !v)}
                >
                  {showAllCollections ? 'Show less' : `Show all ${allCollectionIds.length}`}
                </Button>
              )}
            </div>
          )}

          {/* Artifacts */}
          {artifactsCount > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Artifacts</h3>
              <div className="space-y-1.5">
                {(artifacts ?? []).map((artifact: ArtifactListItem) => {
                  const style = ARTIFACT_STYLES[artifact.type];
                  const Icon = style?.icon ?? FileText;
                  return (
                    <button
                      key={artifact.artifact_id}
                      className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                      onClick={() => {
                        onOpenChange(false);
                        navigate(`/session/${artifact.session_id}`);
                      }}
                    >
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${style?.bg ?? 'bg-muted'}`}>
                        <Icon className={`h-4 w-4 ${style?.color ?? 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{artifact.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {style?.label ?? artifact.type} &middot; {formatDate(artifact.created_at)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Activity Logs */}
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Activity</h3>
            {allLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 italic">No activity recorded yet</p>
            ) : (
              <>
                <div className="space-y-0.5">
                  {logsToShow.map((log: AgentLogEntry, i: number) => {
                    const isLatest = i === 0 && displayTask.status === 'executing';
                    return (
                      <div key={log.id} className="flex items-start gap-2 py-1">
                        {isLatest ? (
                          <CircleDot className="h-3 w-3 mt-0.5 shrink-0 animate-pulse text-accent-vibrant/70" />
                        ) : (
                          <Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/40" strokeWidth={2.5} />
                        )}
                        <span
                          className={`text-xs leading-snug ${
                            isLatest ? 'text-foreground font-medium' : 'text-muted-foreground/60'
                          }`}
                        >
                          {log.message}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
                          {formatLogTime(log.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {allLogs.length > 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 text-xs"
                    onClick={() => setShowAllLogs((v) => !v)}
                  >
                    {showAllLogs ? 'Show less' : `Show all ${allLogs.length}`}
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Todos snapshot */}
          {displayTask.todos && displayTask.todos.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Plan</h3>
              <div className="space-y-1">
                {displayTask.todos.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-2 text-xs">
                    {todo.status === 'completed' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    ) : todo.status === 'in_progress' ? (
                      <Play className="h-3 w-3 text-amber-500 shrink-0" />
                    ) : (
                      <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                      {todo.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>

      {/* Stats Modal */}
      {statsCollectionId && (
        <StatsModal
          source={buildSourceForCollection(statsCollectionId)}
          open={!!statsCollectionId}
          onClose={() => setStatsCollectionId(null)}
        />
      )}

      {/* Table Modal */}
      {tableCollectionId && (
        <TableModal
          source={buildSourceForCollection(tableCollectionId)}
          open={!!tableCollectionId}
          onClose={() => setTableCollectionId(null)}
        />
      )}

      {/* Schedule Edit Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Schedule</DialogTitle>
            <DialogDescription>
              Set how often this agent runs automatically
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Task overview</label>
              <div className="rounded-md bg-muted p-3 text-sm">
                {displayTask.context_summary
                  || displayTask.title
                  + (displayTask.data_scope?.searches?.length
                    ? ` — ${displayTask.data_scope.searches.map((s) => (s.keywords ?? []).join(', ')).join('; ')}`
                    : '')}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Frequency</label>
              <Select value={editPreset} onValueChange={(v) => setEditPreset(v as SchedulePreset)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editPreset !== 'hourly' && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Run at (UTC)</label>
                <Select value={editTime} onValueChange={setEditTime}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_UTC_TIMES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Runs: {formatSchedule(buildScheduleFromPreset(editPreset, editTime))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editRunNow}
                onChange={(e) => setEditRunNow(e.target.checked)}
                className="rounded"
              />
              Run the first task now
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleScheduleSave}>Set Schedule</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
