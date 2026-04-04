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
import type { Agent } from '../../../api/endpoints/agents.ts';
import { runAgent, updateAgent as patchAgent } from '../../../api/endpoints/agents.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { StatusBadge, RUNNABLE_STATUSES } from './agent-status-utils.tsx';
import { Logo } from '../../../components/Logo.tsx';
import { UserMenu } from '../../../components/UserMenu.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { toast } from 'sonner';

interface TaskPageHeaderProps {
  task: Agent;
  onOpenSchedule: () => void;
}

export function AgentPageHeader({ task, onOpenSchedule }: TaskPageHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  const handleRun = async () => {
    try {
      await runAgent(task.task_id);
      toast.success('Agent run started');
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.task_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to start agent');
    }
  };

  const handleStop = async () => {
    try {
      await patchAgent(task.task_id, { status: 'completed' });
      toast.success('Agent stopped');
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.task_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to stop agent');
    }
  };

  const handlePauseResume = async () => {
    const newStatus = task.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchAgent(task.task_id, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.task_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to update agent');
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
