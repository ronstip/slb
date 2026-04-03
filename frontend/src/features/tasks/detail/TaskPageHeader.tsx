import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  Pause,
  Play,
  Repeat,
  StopCircle,
} from 'lucide-react';
import type { Task } from '../../../api/endpoints/tasks.ts';
import { runTask, updateTask as patchTask } from '../../../api/endpoints/tasks.ts';
import { useTaskStore } from '../../../stores/task-store.ts';
import { StatusBadge, RUNNABLE_STATUSES } from './task-status-utils.tsx';
import { Logo } from '../../../components/Logo.tsx';
import { UserMenu } from '../../../components/UserMenu.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { toast } from 'sonner';

interface TaskPageHeaderProps {
  task: Task;
  onOpenSchedule: () => void;
}

export function TaskPageHeader({ task, onOpenSchedule }: TaskPageHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  const handleRun = async () => {
    try {
      await runTask(task.task_id);
      toast.success('Task run started');
      queryClient.invalidateQueries({ queryKey: ['task-detail', task.task_id] });
      fetchTasks();
    } catch {
      toast.error('Failed to start task');
    }
  };

  const handleStop = async () => {
    try {
      await patchTask(task.task_id, { status: 'completed' });
      toast.success('Task stopped');
      queryClient.invalidateQueries({ queryKey: ['task-detail', task.task_id] });
      fetchTasks();
    } catch {
      toast.error('Failed to stop task');
    }
  };

  const handlePauseResume = async () => {
    const newStatus = task.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchTask(task.task_id, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['task-detail', task.task_id] });
      fetchTasks();
    } catch {
      toast.error('Failed to update task');
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <button onClick={() => navigate('/')} className="shrink-0 focus:outline-none">
        <Logo size="sm" showText={false} />
      </button>

      <div className="h-6 w-px bg-border" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
        <StatusBadge status={task.status} />
      </div>

      <div className="flex items-center gap-1.5">
        {task.status === 'executing' && (
          <Button size="sm" variant="destructive" onClick={handleStop}>
            <StopCircle className="mr-1.5 h-3 w-3" /> Stop
          </Button>
        )}

        {canRun && (
          <Button size="sm" variant="outline" onClick={handleRun}>
            {task.task_type === 'recurring' ? (
              <><Play className="mr-1.5 h-3 w-3" />Run Now</>
            ) : (
              <><Repeat className="mr-1.5 h-3 w-3" />Re-run</>
            )}
          </Button>
        )}

        {task.task_type === 'recurring' && (task.status === 'monitoring' || task.status === 'paused') && (
          <Button size="sm" variant="outline" onClick={handlePauseResume}>
            {task.status === 'monitoring' ? (
              <><Pause className="mr-1.5 h-3 w-3" />Pause</>
            ) : (
              <><Play className="mr-1.5 h-3 w-3" />Resume</>
            )}
          </Button>
        )}

        {task.task_type !== 'recurring' && ['completed', 'approved'].includes(task.status) && (
          <Button size="sm" variant="outline" onClick={onOpenSchedule}>
            <CalendarClock className="mr-1.5 h-3 w-3" /> Schedule
          </Button>
        )}

        <UserMenu />
      </div>
    </header>
  );
}
