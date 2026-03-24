import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Archive,
  BarChart3,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock,
  ChevronDown,
  ChevronUp,
  Filter,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Search,
  StopCircle,
  Table2,
  Trash2,
} from 'lucide-react';
import { useTaskStore } from '../../stores/task-store.ts';
import type { Task, TaskStatus } from '../../api/endpoints/tasks.ts';
import { deleteTask, getTask, runTask, updateTask as patchTask, getTaskArtifacts, getTaskLogs } from '../../api/endpoints/tasks.ts';
import type { TaskLogEntry } from '../../api/endpoints/tasks.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';
import { CollectionProgressCard } from '../chat/cards/CollectionProgressCard.tsx';
import { StatsModal } from '../sources/StatsModal.tsx';
import { TableModal } from '../sources/TableModal.tsx';
import { ARTIFACT_STYLES } from '../artifacts/artifact-utils.ts';
import type { ArtifactListItem } from '../../api/endpoints/artifacts.ts';
import type { Source } from '../../stores/sources-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  seed: { icon: <ClipboardList className="h-3 w-3" />, label: 'Draft', color: 'text-muted-foreground' },
  drafting: { icon: <ClipboardList className="h-3 w-3" />, label: 'Drafting', color: 'text-muted-foreground' },
  review: { icon: <ClipboardList className="h-3 w-3" />, label: 'Review', color: 'text-yellow-500' },
  approved: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Approved', color: 'text-blue-500' },
  executing: { icon: <Play className="h-3 w-3" />, label: 'Running', color: 'text-amber-500' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', color: 'text-green-500' },
  monitoring: { icon: <Radio className="h-3 w-3" />, label: 'Monitoring', color: 'text-violet-500' },
  paused: { icon: <Pause className="h-3 w-3" />, label: 'Paused', color: 'text-muted-foreground' },
  archived: { icon: <Archive className="h-3 w-3" />, label: 'Archived', color: 'text-muted-foreground' },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.seed;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

const ALL_STATUSES: TaskStatus[] = [
  'executing', 'monitoring', 'review', 'approved',
  'completed', 'paused', 'archived', 'seed', 'drafting',
];

const RUNNABLE_STATUSES: TaskStatus[] = ['completed', 'monitoring', 'paused', 'approved', 'executing'];

function formatLastRun(runHistory: Task['run_history']): string {
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

/** Status color used for the accent bar at the top of the drawer */
const STATUS_ACCENT: Record<string, string> = {
  seed: 'bg-muted-foreground/30',
  drafting: 'bg-muted-foreground/30',
  review: 'bg-yellow-500',
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

/** Build a minimal Source object from a collection ID so we can pass it to StatsModal / TableModal */
function buildSourceForCollection(collectionId: string): Source {
  const stored = useSourcesStore.getState().sources.find((s) => s.collectionId === collectionId);
  if (stored) return stored;
  // Fallback minimal source — modals only need collectionId + title
  return {
    collectionId,
    status: 'completed',
    config: { platforms: [], keywords: [], time_range_days: 7 } as Source['config'],
    title: collectionId.slice(0, 8),
    postsCollected: 0,
    totalViews: 0,
    positivePct: null,
    selected: false,
    active: false,
    createdAt: '',
  };
}

function TaskDetailDrawer({ task, open, onOpenChange }: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [statsCollectionId, setStatsCollectionId] = useState<string | null>(null);
  const [tableCollectionId, setTableCollectionId] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [protocolExpanded, setProtocolExpanded] = useState(false);

  // Live refresh while task is executing
  const { data: freshTask } = useQuery({
    queryKey: ['task-detail', task?.task_id],
    queryFn: () => getTask(task!.task_id),
    enabled: open && !!task?.task_id,
    refetchInterval: (query) => {
      const s = query.state.data?.status ?? task?.status;
      return s === 'executing' ? 10_000 : false;
    },
  });
  const displayTask = freshTask ?? task;

  // Artifacts for this task
  const { data: artifacts } = useQuery({
    queryKey: ['task-artifacts', task?.task_id],
    queryFn: () => getTaskArtifacts(task!.task_id),
    enabled: open && !!task?.task_id && (task?.artifact_ids?.length ?? 0) > 0,
  });

  // Activity logs
  const { data: logs } = useQuery({
    queryKey: ['task-logs', task?.task_id],
    queryFn: () => getTaskLogs(task!.task_id),
    enabled: open && !!task?.task_id,
    refetchInterval: (query) => {
      const s = displayTask?.status;
      return s === 'executing' ? 5_000 : false;
    },
  });

  if (!displayTask) return null;

  const collectionsCount = displayTask.collection_ids?.length || 0;
  const artifactsCount = displayTask.artifact_ids?.length || 0;

  // Show last 6 collections (newest first), with "show all" toggle
  const allCollectionIds = [...(displayTask.collection_ids || [])].reverse();
  const collectionsToShow = showAllCollections ? allCollectionIds : allCollectionIds.slice(0, 6);

  // Sessions for multi-conversation support
  const sessionIds = displayTask.session_ids?.length
    ? displayTask.session_ids
    : displayTask.primary_session_id
      ? [displayTask.primary_session_id]
      : [];

  const canRun = RUNNABLE_STATUSES.includes(displayTask.status);

  const handleRunDrawer = async () => {
    setIsRunning(true);
    try {
      await runTask(displayTask.task_id);
      queryClient.invalidateQueries({ queryKey: ['task-detail', displayTask.task_id] });
      fetchTasks();
    } catch {
      // 409 or other error — task may already be running
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await patchTask(displayTask.task_id, { status: 'completed' });
      queryClient.invalidateQueries({ queryKey: ['task-detail', displayTask.task_id] });
      fetchTasks();
    } catch {
      // ignore
    } finally {
      setIsStopping(false);
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
              <div className="text-xl font-bold">{displayTask.run_count || 0}</div>
              <div className="text-[10px] text-muted-foreground">Runs</div>
            </div>
          </div>

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
                      {sid === displayTask.primary_session_id ? 'Primary Conversation' : `Conversation ${i + 1}`}
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
                {isStopping ? 'Stopping…' : 'Stop Task'}
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
                  {logsToShow.map((log: TaskLogEntry, i: number) => {
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

          {/* Protocol — collapsible sneak peek */}
          {displayTask.protocol && (
            <div className="mt-6">
              <button
                className="flex w-full items-center justify-between mb-2 group"
                onClick={() => setProtocolExpanded((v) => !v)}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Protocol</h3>
                {protocolExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              <div className="relative rounded-lg border p-4 prose prose-sm dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground max-w-none overflow-hidden"
                style={protocolExpanded ? undefined : { maxHeight: '120px' }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayTask.protocol}</ReactMarkdown>
                {!protocolExpanded && (
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                )}
              </div>
            </div>
          )}

          {/* Run History */}
          {displayTask.run_history && displayTask.run_history.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Run History</h3>
              <div className="space-y-1.5">
                {displayTask.run_history.map((run, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {run.run_at ? new Date(run.run_at).toLocaleString() : `Run ${i + 1}`}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{run.status}</Badge>
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
    </Sheet>
  );
}

export function TasksPage() {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh while any task is executing
  useEffect(() => {
    const hasExecuting = tasks.some((t) => t.status === 'executing');
    if (!hasExecuting) return;
    const interval = setInterval(() => fetchTasks(), 15_000);
    return () => clearInterval(interval);
  }, [tasks, fetchTasks]);

  const filteredTasks = tasks.filter((t) => {
    if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        (t.seed || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const toggleStatus = (status: TaskStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const handleRowClick = (task: Task) => {
    setSelectedTask(task);
    setDrawerOpen(true);
  };

  const handleDelete = async (task: Task) => {
    try {
      await deleteTask(task.task_id);
      fetchTasks();
    } catch {
      // silent
    }
  };

  const handleRun = async (task: Task) => {
    try {
      await runTask(task.task_id);
      fetchTasks();
    } catch {
      // 409 or other error
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ClipboardList className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="flex-1" />
        <Button size="sm" onClick={() => navigate('/')}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-6 py-3 border-b">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Status
              {statusFilter.size > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {statusFilter.size}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ALL_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilter.has(s)}
                onCheckedChange={() => toggleStatus(s)}
              >
                <span className="flex items-center gap-2">
                  <span className={STATUS_CONFIG[s]?.color}>{STATUS_CONFIG[s]?.icon}</span>
                  {STATUS_CONFIG[s]?.label || s}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-6 py-4 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 rounded border border-border/30 bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ClipboardList className="h-10 w-10 opacity-30 mb-3" />
            <p className="text-sm font-medium">
              {search || statusFilter.size > 0 ? 'No tasks match your filters' : 'No tasks yet'}
            </p>
            <p className="text-xs mt-1">
              {search || statusFilter.size > 0
                ? 'Try adjusting your search or filters'
                : 'Start a new conversation and describe what you need done'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-[11px] text-muted-foreground font-medium">
                <th className="text-left px-6 py-2.5">Title</th>
                <th className="text-left px-3 py-2.5 w-28">Status</th>
                <th className="text-left px-3 py-2.5 w-24">Type</th>
                <th className="text-left px-3 py-2.5 w-24">Collections</th>
                <th className="text-left px-3 py-2.5 w-24">Last Run</th>
                <th className="text-left px-3 py-2.5 w-28">Created</th>
                <th className="text-right px-3 py-2.5 w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const createdDate = task.created_at
                  ? new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '';

                return (
                  <tr
                    key={task.task_id}
                    onClick={() => handleRowClick(task)}
                    className="border-b border-border/40 cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-foreground truncate max-w-md">
                        {task.title}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        {task.task_type === 'recurring' && <Repeat className="h-3 w-3" />}
                        {task.task_type === 'recurring' ? 'Recurring' : 'One-shot'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.collection_ids?.length || 0}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatLastRun(task.run_history)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {createdDate}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider delayDuration={300}>
                          {task.primary_session_id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => navigate(`/session/${task.primary_session_id}`)}
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open Session</TooltipContent>
                            </Tooltip>
                          )}
                          {RUNNABLE_STATUSES.includes(task.status) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleRun(task)}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{task.task_type === 'recurring' ? 'Run Now' : 'Re-run'}</TooltipContent>
                            </Tooltip>
                          )}
                          {(task.artifact_ids?.length ?? 0) > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleRowClick(task)}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View Artifacts</TooltipContent>
                            </Tooltip>
                          )}
                        </TooltipProvider>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleRowClick(task)}>
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(task)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
