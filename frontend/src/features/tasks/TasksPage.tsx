import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ClipboardList,
  Compass,
  FileText,
  Filter,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { useTaskStore } from '../../stores/task-store.ts';
import { TaskDataExplorer } from './TaskDataExplorer.tsx';
import { TaskDetailDrawer, StatusBadge, RUNNABLE_STATUSES, STATUS_CONFIG, formatLastRun } from './TaskDetailDrawer.tsx';
import type { Task, TaskStatus } from '../../api/endpoints/tasks.ts';
import { deleteTask, runTask } from '../../api/endpoints/tasks.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
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
import { formatSchedule } from '../../lib/constants.ts';

const ALL_STATUSES: TaskStatus[] = [
  'executing', 'monitoring', 'approved',
  'completed', 'paused', 'archived',
];

/** Relative time for future dates (e.g. "in 6h", "Tomorrow") */
function formatRelativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return 'now';
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 24) return `in ${diffH}h`;
  if (diffH < 48) return 'Tomorrow';
  const diffD = Math.round(diffMs / 86_400_000);
  return `in ${diffD}d`;
}

export function TasksPage() {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const error = useTaskStore((s) => s.error);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openScheduleOnDrawer, setOpenScheduleOnDrawer] = useState(false);
  const [explorerTask, setExplorerTask] = useState<Task | null>(null);

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

  const filteredTasks = tasks
    .filter((t) => {
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      // Monitoring tasks first
      const aMonitoring = a.status === 'monitoring' ? 0 : 1;
      const bMonitoring = b.status === 'monitoring' ? 0 : 1;
      if (aMonitoring !== bMonitoring) return aMonitoring - bMonitoring;
      // Then by next_run_at ascending (nulls last)
      if (a.next_run_at && b.next_run_at) {
        const diff = new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime();
        if (diff !== 0) return diff;
      } else if (a.next_run_at) return -1;
      else if (b.next_run_at) return 1;
      // Then by created_at descending
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
    setOpenScheduleOnDrawer(false);
    setDrawerOpen(true);
  };

  const handleScheduleFromTable = (task: Task) => {
    setSelectedTask(task);
    setOpenScheduleOnDrawer(true);
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
    <div className="flex h-screen w-full flex-col overflow-x-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ClipboardList className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="flex-1" />
        <Button size="sm" onClick={() => { toast('Start a conversation to set up recurring monitoring or scheduled automation.'); navigate('/'); }}>
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
            {statusFilter.size > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setStatusFilter(new Set())}>
                  <X className="mr-2 h-3.5 w-3.5" />
                  Clear filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between px-6 py-3 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fetchTasks()}>
            Retry
          </Button>
        </div>
      )}

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
                : 'Ask the AI to set up recurring monitoring or automate a scheduled report to create a task'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-[11px] text-muted-foreground font-medium">
                <th className="text-left px-6 py-2.5">Title</th>
                <th className="text-center px-3 py-2.5 w-36">Actions</th>
                <th className="text-left px-3 py-2.5 w-28">Status</th>
                <th className="text-left px-3 py-2.5 w-28">
                  <span className="flex items-center gap-1"><Timer className="h-3 w-3" />Schedule</span>
                </th>
                <th className="text-left px-3 py-2.5 w-24">Next Run</th>
                <th className="text-left px-3 py-2.5 w-24">Last Run</th>
                <th className="text-left px-3 py-2.5 w-24">Collections</th>
                <th className="text-left px-3 py-2.5 w-24">Artifacts</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const lastRun = task.run_history?.length
                  ? task.run_history[task.run_history.length - 1]
                  : null;

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
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!(task.session_id || task.primary_session_id)}
                                onClick={() => navigate(`/session/${task.session_id || task.primary_session_id}`)}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open Session</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!RUNNABLE_STATUSES.includes(task.status)}
                                onClick={() => handleRun(task)}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{task.task_type === 'recurring' ? 'Run Now' : 'Re-run'}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={task.task_type === 'recurring' || !['completed', 'approved'].includes(task.status)}
                                onClick={() => handleScheduleFromTable(task)}
                              >
                                <Timer className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Enable Schedule</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={(task.artifact_ids?.length ?? 0) === 0}
                                onClick={() => handleRowClick(task)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View Artifacts</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={(task.collection_ids?.length ?? 0) === 0}
                                onClick={() => setExplorerTask(task)}
                              >
                                <Compass className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Explore Data</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleRowClick(task)}>
                              View Details
                            </DropdownMenuItem>
                            {(task.collection_ids?.length ?? 0) > 0 && (
                              <DropdownMenuItem onClick={() => setExplorerTask(task)}>
                                <Compass className="mr-2 h-3.5 w-3.5" />
                                Explore Data
                              </DropdownMenuItem>
                            )}
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
                    <td className="px-3 py-3">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.task_type === 'recurring' && task.schedule
                        ? formatSchedule(task.schedule.frequency)
                        : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.status === 'paused'
                        ? 'Paused'
                        : task.status === 'monitoring' && task.next_run_at
                          ? formatRelativeTime(task.next_run_at)
                          : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {lastRun ? (
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${lastRun.status === 'started' || lastRun.status === 'completed' ? 'bg-green-500' : 'bg-amber-500'}`} />
                          {formatLastRun(task.run_history)}
                        </span>
                      ) : '\u2014'}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.collection_ids?.length || 0}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {task.artifact_ids?.length || 0}
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
        autoOpenSchedule={openScheduleOnDrawer}
        onExploreData={setExplorerTask}
      />

      <TaskDataExplorer
        task={explorerTask}
        open={!!explorerTask}
        onClose={() => setExplorerTask(null)}
      />
    </div>
  );
}
