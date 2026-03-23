import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ClipboardList,
  Plus,
  Search,
  Filter,
  Play,
  CheckCircle2,
  Radio,
  Pause,
  Archive,
  Repeat,
  ArrowLeft,
} from 'lucide-react';
import { useTaskStore } from '../../stores/task-store.ts';
import type { Task, TaskStatus } from '../../api/endpoints/tasks.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';

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

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const createdDate = task.created_at
    ? new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const updatedDate = task.updated_at
    ? new Date(task.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 w-full rounded-lg border border-border/50 bg-card px-4 py-3 text-left transition-all hover:border-border hover:shadow-sm"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {task.title}
          </span>
          {task.task_type === 'recurring' && (
            <Repeat className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {task.seed?.slice(0, 100)}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <StatusBadge status={task.status} />
        <span className="text-[11px] text-muted-foreground w-16 text-right" title={`Updated ${updatedDate}`}>
          {createdDate}
        </span>
      </div>
    </button>
  );
}

const ALL_STATUSES: TaskStatus[] = [
  'executing', 'monitoring', 'review', 'approved',
  'completed', 'paused', 'archived', 'seed', 'drafting',
];

export function TasksPage() {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(new Set());

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

  const handleTaskClick = (task: Task) => {
    if (task.primary_session_id) {
      navigate(`/session/${task.primary_session_id}`);
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
      <div className="flex items-center gap-2 px-6 py-3">
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

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="space-y-2 mt-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-lg border border-border/30 bg-muted/20 animate-pulse" />
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
          <div className="space-y-1.5 mt-1">
            {filteredTasks.map((task) => (
              <TaskRow key={task.task_id} task={task} onClick={() => handleTaskClick(task)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
