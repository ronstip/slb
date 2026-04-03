import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CalendarClock,
  Pause,
  Play,
  Repeat,
  StopCircle,
} from 'lucide-react';
import { useTaskStore } from '../../../stores/task-store.ts';
import { runTask, updateTask as patchTask } from '../../../api/endpoints/tasks.ts';
import { useTaskDetail } from './useTaskDetail.ts';
import { TaskDetailSidebar } from './TaskDetailSidebar.tsx';
import type { DetailTab } from './TaskDetailSidebar.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { TaskOverviewTab } from './tabs/TaskOverviewTab.tsx';
import { TaskChatTab } from './tabs/TaskChatTab.tsx';
import { TaskCollectionsTab } from './tabs/TaskCollectionsTab.tsx';
import { TaskArtifactsTab } from './tabs/TaskArtifactsTab.tsx';
import { TaskExplorerTab } from './tabs/TaskExplorerTab.tsx';
import { StatusBadge, RUNNABLE_STATUSES } from './task-status-utils.tsx';
import { Button } from '../../../components/ui/button.tsx';

const VALID_TABS: DetailTab[] = ['overview', 'chat', 'collections', 'artifacts', 'explorer'];

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const tabParam = searchParams.get('tab') as DetailTab | null;
  const activeTab: DetailTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: DetailTab) => {
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };

  // Load task into store on mount
  useEffect(() => {
    if (taskId) {
      useTaskStore.getState().loadTask(taskId);
    }
  }, [taskId]);

  const { task, isLoading, artifacts, logs } = useTaskDetail(taskId);

  const handleRun = async () => {
    if (!task) return;
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
    if (!task) return;
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
    if (!task) return;
    const newStatus = task.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchTask(task.task_id, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['task-detail', task.task_id] });
      fetchTasks();
    } catch {
      toast.error('Failed to update task');
    }
  };

  if (!taskId) {
    navigate('/tasks', { replace: true });
    return null;
  }

  if (isLoading && !task) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-muted-foreground">Task not found</p>
        <button
          onClick={() => navigate('/tasks')}
          className="text-sm text-primary hover:underline"
        >
          Back to Tasks
        </button>
      </div>
    );
  }

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  return (
    <div className="flex h-screen bg-background">
      {/* Left sidebar — navigation only */}
      <TaskDetailSidebar
        task={task}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasCollections={(task.collection_ids?.length ?? 0) > 0}
        hasArtifacts={(task.artifact_ids?.length ?? 0) > 0}
        onRun={handleRun}
        onStop={handleStop}
        onPauseResume={handlePauseResume}
        onOpenSchedule={() => setScheduleOpen(true)}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header: back + task title + status + actions */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/50 px-4">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="h-5 w-px bg-border/60" />

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {task.status === 'executing' && (
              <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleStop}>
                <StopCircle className="mr-1.5 h-3.5 w-3.5" /> Stop
              </Button>
            )}
            {canRun && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleRun}>
                {task.task_type === 'recurring' ? (
                  <><Play className="mr-1.5 h-3.5 w-3.5" />Run Now</>
                ) : (
                  <><Repeat className="mr-1.5 h-3.5 w-3.5" />Re-run</>
                )}
              </Button>
            )}
            {task.task_type === 'recurring' && (task.status === 'monitoring' || task.status === 'paused') && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handlePauseResume}>
                {task.status === 'monitoring' ? (
                  <><Pause className="mr-1.5 h-3.5 w-3.5" />Pause</>
                ) : (
                  <><Play className="mr-1.5 h-3.5 w-3.5" />Resume</>
                )}
              </Button>
            )}
            {task.task_type !== 'recurring' && ['completed', 'approved'].includes(task.status) && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setScheduleOpen(true)}>
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Schedule
              </Button>
            )}
          </div>
        </header>

        {/* Tab content */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {activeTab === 'overview' && (
            <TaskOverviewTab
              task={task}
              artifacts={artifacts}
              logs={logs}
              onTabChange={setActiveTab}
              onOpenSchedule={() => setScheduleOpen(true)}
            />
          )}
          {activeTab === 'chat' && <TaskChatTab task={task} />}
          {activeTab === 'collections' && <TaskCollectionsTab task={task} />}
          {activeTab === 'artifacts' && <TaskArtifactsTab task={task} artifacts={artifacts} />}
          {activeTab === 'explorer' && <TaskExplorerTab task={task} />}
        </main>
      </div>

      <ScheduleDialog task={task} open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </div>
  );
}
