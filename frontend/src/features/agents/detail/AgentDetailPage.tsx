import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { runAgent, updateAgent as patchAgent } from '../../../api/endpoints/agents.ts';
import { useAgentDetail } from './useAgentDetail.ts';
import { useAgentEditMode } from './useAgentEditMode.ts';
import { AppSidebar } from '../../../components/AppSidebar.tsx';
import type { DetailTab } from '../../../components/AppSidebar.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { AgentOverviewTab } from './tabs/AgentOverviewTab.tsx';
import { AgentChatTab } from './tabs/AgentChatTab.tsx';
import { AgentCollectionsTab } from './tabs/AgentCollectionsTab.tsx';
import { AgentArtifactsTab } from './tabs/AgentArtifactsTab.tsx';
import { AgentExplorerTab } from './tabs/AgentExplorerTab.tsx';
import { RUNNABLE_STATUSES } from './agent-status-utils.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog.tsx';

const VALID_TABS: DetailTab[] = ['overview', 'chat', 'collections', 'artifacts', 'explorer'];

export function AgentDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const agentSessions = useSessionStore((s) => s.agentSessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const tabParam = searchParams.get('tab') as DetailTab | null;
  const activeTab: DetailTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: DetailTab) => {
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };

  const handleSessionSelect = (sessionId: string) => {
    setSearchParams({ tab: 'chat', session: sessionId }, { replace: true });
  };

  const handleNewChat = () => {
    setSearchParams({ tab: 'chat' }, { replace: true });
    if (taskId) {
      useSessionStore.getState().startNewAgentSession(taskId);
    }
  };

  useEffect(() => {
    if (taskId) {
      useAgentStore.getState().loadAgent(taskId);
      useSessionStore.getState().fetchAgentSessions(taskId);
    }
  }, [taskId]);

  const { task, isLoading, artifacts, logs } = useAgentDetail(taskId);
  const editMode = useAgentEditMode(task);

  // Block navigation when there are unsaved edits
  const blocker = useBlocker(editMode.isDirty);

  // Browser tab close / refresh guard
  useEffect(() => {
    if (!editMode.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editMode.isDirty]);

  const handleRun = async () => {
    if (!task) return;
    try {
      await runAgent(task.agent_id);
      toast.success('Agent run started');
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to start agent');
    }
  };

  const handleStop = async () => {
    if (!task) return;
    try {
      await patchAgent(task.agent_id, { status: 'success' });
      toast.success('Agent stopped');
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
      fetchAgents();
    } catch {
      toast.error('Failed to stop agent');
    }
  };

  const handlePauseResume = async () => {
    if (!task) return;
    const newPaused = !task.paused;
    try {
      await patchAgent(task.agent_id, { paused: newPaused } as Parameters<typeof patchAgent>[1]);
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
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

  const canRun = RUNNABLE_STATUSES.includes(task.status) && task.status !== 'running';

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
          agentSessions={agentSessions}
          activeSessionId={activeSessionId}
          onSessionSelect={handleSessionSelect}
          onNewChat={handleNewChat}
        />
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab content */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {activeTab === 'overview' && (
            <AgentOverviewTab
              task={task}
              artifacts={artifacts}
              logs={logs}
              onTabChange={setActiveTab}
              onOpenSchedule={() => setScheduleOpen(true)}
              onRun={handleRun}
              onStop={handleStop}
              canRun={canRun}
              isEditing={editMode.isEditing}
              draft={editMode.draft}
              isDirty={editMode.isDirty}
              isSaving={editMode.isSaving}
              onEnterEdit={editMode.enterEdit}
              onSave={editMode.save}
              onCancelEdit={editMode.cancel}
              onUpdateDraft={editMode.updateDraft}
            />
          )}
          {activeTab === 'chat' && <AgentChatTab task={task} />}
          {activeTab === 'collections' && <AgentCollectionsTab task={task} />}
          {activeTab === 'artifacts' && <AgentArtifactsTab task={task} artifacts={artifacts} />}
          {activeTab === 'explorer' && <AgentExplorerTab task={task} />}
        </main>
      </div>

      <ScheduleDialog task={task} open={scheduleOpen} onOpenChange={setScheduleOpen} />

      {/* Unsaved changes confirmation dialog */}
      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits. Are you sure you want to leave? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
