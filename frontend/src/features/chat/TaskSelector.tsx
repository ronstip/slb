import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, ChevronDown, ExternalLink } from 'lucide-react';
import { useTaskStore } from '../../stores/task-store.ts';
import type { Task } from '../../api/endpoints/tasks.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';

const STATUS_LABELS: Record<string, string> = {
  executing: 'Running',
  monitoring: 'Monitoring',
  completed: 'Done',
  review: 'Review',
  approved: 'Approved',
  paused: 'Paused',
};

function TaskItem({ task, isActive, onClick }: {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      }`}
    >
      <span className="flex-1 truncate text-xs">{task.title}</span>
      <Badge variant="outline" className="text-[9px] h-4 shrink-0">
        {STATUS_LABELS[task.status] || task.status}
      </Badge>
    </button>
  );
}

export function TaskSelector() {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const activeTask = useTaskStore((s) => s.activeTask);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  useEffect(() => {
    if (tasks.length === 0) fetchTasks();
  }, [tasks.length, fetchTasks]);

  // Only show tasks that have been approved or beyond
  const visibleTasks = tasks.filter((t) =>
    ['approved', 'executing', 'completed', 'monitoring', 'paused'].includes(t.status),
  );

  if (visibleTasks.length === 0 && !activeTask) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
          <ClipboardList className="h-3 w-3" />
          {activeTask ? (
            <span className="max-w-[160px] truncate">{activeTask.title}</span>
          ) : (
            <span>Tasks</span>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {activeTaskId && (
            <button
              onClick={() => setActiveTask(null)}
              className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50"
            >
              Clear task context
            </button>
          )}
          {visibleTasks.map((task) => (
            <TaskItem
              key={task.task_id}
              task={task}
              isActive={task.task_id === activeTaskId}
              onClick={() => setActiveTask(task.task_id)}
            />
          ))}
        </div>
        <div className="border-t mt-2 pt-2">
          <button
            onClick={() => navigate('/tasks')}
            className="flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50"
          >
            <ExternalLink className="h-3 w-3" />
            View all tasks
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
