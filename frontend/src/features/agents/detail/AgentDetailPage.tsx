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
import { useAgentStore } from '../../../stores/agent-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { runAgent, updateAgent as patchAgent } from '../../../api/endpoints/agents.ts';
import { useAgentDetail } from './useAgentDetail.ts';
import { AppSidebar } from '../../../components/AppSidebar.tsx';
import type { DetailTab } from '../../../components/AppSidebar.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { AgentOverviewTab } from './tabs/AgentOverviewTab.tsx';
import { AgentChatTab } from './tabs/AgentChatTab.tsx';
import { AgentCollectionsTab } from './tabs/AgentCollectionsTab.tsx';
import { AgentArtifactsTab } from './tabs/AgentArtifactsTab.tsx';
import { AgentExplorerTab } from './tabs/AgentExplorerTab.tsx';
import { StatusBadge, RUNNABLE_STATUSES } from './agent-status-utils.tsx';
import { Button } from '../../../components/ui/button.tsx';

const VALID_TABS: DetailTab[] = ['overview', 'chat', 'collections', 'artifacts', 'explorer'];

export function AgentDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);

  const tabParam = searchParams.get('tab') as DetailTab | null;
  const activeTab: DetailTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: DetailTab) => {
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };

  useEffect(() => {
    if (taskId) {
      useAgentStore.getState().loadAgent(taskId);
    }
  }, [taskId]);

  const { task, isLoading, artifacts, logs } = useAgentDetail(taskId);

  const handleRun = async () => {
    if (!task) return;
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
    if (!task) return;
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
    if (!task) return;
    const newStatus = task.status === 'monitoring' ? 'paused' : 'monitoring';
    try {
      await patchAgent(task.task_id, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.task_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to update agent');
    }
  };

  if (!taskId) {
    navigate('/agents', { replace: true });
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
        <p className="text-sm text-muted-foreground">Agent not found</p>
        <button
          onClick={() => navigate('/agents')}
          className="text-sm text-primary hover:underline"
        >
          Back to Agents
        </button>
      </div>
    );
  }

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'executing';

  return (
    <div className="flex h-screen bg-background">
      {/* Unified sidebar */}
      <aside
        className="shrink-0 overflow-hidden border-r border-border bg-white dark:bg-[#0B1120]"
        style={{ width: sidebarCollapsed ? 48 : 280 }}
      >
        <AppSidebar
          activeAgent={task}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasCollections={(task.collection_ids?.length ?? 0) > 0}
          hasArtifacts={(task.artifact_ids?.length ?? 0) > 0}
          onRun={handleRun}
          onStop={handleStop}
          onPauseResume={handlePauseResume}
          onOpenSchedule={() => setScheduleOpen(true)}
        />
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
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
            <AgentOverviewTab
              task={task}
              artifacts={artifacts}
              logs={logs}
              onTabChange={setActiveTab}
              onOpenSchedule={() => setScheduleOpen(true)}
            />
          )}
          {activeTab === 'chat' && <AgentChatTab task={task} />}
          {activeTab === 'collections' && <AgentCollectionsTab task={task} />}
          {activeTab === 'artifacts' && <AgentArtifactsTab task={task} artifacts={artifacts} />}
          {activeTab === 'explorer' && <AgentExplorerTab task={task} />}
        </main>
      </div>

      <ScheduleDialog task={task} open={scheduleOpen} onOpenChange={setScheduleOpen} />
    </div>
  );
}
