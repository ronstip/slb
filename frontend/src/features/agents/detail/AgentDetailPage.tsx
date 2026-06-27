import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useExplorerLayoutStore } from '../../../stores/explorer-layout-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { runAgent, resumeAgent, updateAgent as patchAgent } from '../../../api/endpoints/agents.ts';
import { confirmAgentRun } from '../../../components/confirm-dialog.tsx';
import { useAgentDetail } from './useAgentDetail.ts';
import { useAgentEditMode } from './useAgentEditMode.ts';
import { AppSidebar } from '../../../components/AppSidebar.tsx';
import { MobileHeader } from '../../../components/MobileHeader.tsx';
import { MobileSidebar } from '../../../components/MobileSidebar.tsx';
import { MobileTabBar } from '../../../components/MobileTabBar.tsx';
import type { DetailTab } from '../../../components/AppSidebar.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { RUNNABLE_STATUSES } from './agent-status-utils.tsx';

// Tab content is code-split: only the bundle for the active tab is fetched.
// Eagerly importing all six tabs pulls recharts, chart.js, react-grid-layout,
// the chat module, etc. into the agent-detail entry chunk.
const AgentOverviewTab = lazy(() =>
  import('./tabs/AgentOverviewTab.tsx').then((m) => ({ default: m.AgentOverviewTab })),
);
const AgentSettingsTab = lazy(() =>
  import('./tabs/AgentSettingsTab.tsx').then((m) => ({ default: m.AgentSettingsTab })),
);
const AgentChatTab = lazy(() =>
  import('./tabs/AgentChatTab.tsx').then((m) => ({ default: m.AgentChatTab })),
);
const AgentCollectionsTab = lazy(() =>
  import('./tabs/AgentCollectionsTab.tsx').then((m) => ({ default: m.AgentCollectionsTab })),
);
const AgentArtifactsTab = lazy(() =>
  import('./tabs/AgentArtifactsTab.tsx').then((m) => ({ default: m.AgentArtifactsTab })),
);
const AgentExplorerTab = lazy(() =>
  import('./tabs/AgentExplorerTab.tsx').then((m) => ({ default: m.AgentExplorerTab })),
);
// The "Alerts" tab renders the Watch system (the unified alerting UI).
const AgentWatchesTab = lazy(() =>
  import('./tabs/AgentWatchesTab.tsx').then((m) => ({ default: m.AgentWatchesTab })),
);

function TabFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}
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

const VALID_TABS: DetailTab[] = ['overview', 'chat', 'data', 'artifacts', 'explorer', 'alerts', 'settings'];

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
  const agentLayouts = useExplorerLayoutStore((s) => s.agentLayouts);
  const activeLayoutId = useExplorerLayoutStore((s) => s.activeLayoutId);
  const startInEditMode = useExplorerLayoutStore((s) => s.startInEditMode);

  const tabParam = searchParams.get('tab') as DetailTab | null;
  const activeTab: DetailTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';
  // Active explorer layout is persisted in the URL (?tab=explorer&layout=…) so
  // refresh, back/forward, and shared links restore the same dashboard. The
  // store is mirrored from the URL via a sync effect below.
  const layoutParam = searchParams.get('layout');

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

  const handleLayoutSelect = (layoutId: string | null) => {
    useExplorerLayoutStore.getState().selectLayout(layoutId);
    const next: Record<string, string> = { tab: 'explorer' };
    if (layoutId) next.layout = layoutId;
    setSearchParams(next, { replace: true });
  };

  const handleNewLayout = async () => {
    if (!taskId) return;
    try {
      const newId = await useExplorerLayoutStore.getState().createLayout(taskId, 'Untitled Layout');
      setSearchParams({ tab: 'explorer', layout: newId }, { replace: true });
    } catch {
      toast.error('Failed to create layout');
    }
  };

  // Sync the URL's `layout` param into the explorer-layout store. Runs whenever
  // the URL changes (initial mount, refresh, back/forward), so the dashboard
  // matches what the URL says - making layouts bookmarkable and shareable.
  useEffect(() => {
    if (activeTab !== 'explorer') return;
    const desired = layoutParam ?? null;
    if (useExplorerLayoutStore.getState().activeLayoutId !== desired) {
      useExplorerLayoutStore.getState().selectLayout(desired);
    }
  }, [layoutParam, activeTab]);

  useEffect(() => {
    if (taskId) {
      useSessionStore.getState().fetchAgentSessions(taskId);
      useExplorerLayoutStore.getState().fetchAgentLayouts(taskId);
    }
  }, [taskId]);

  const { task, isLoading, artifacts, logs } = useAgentDetail(taskId);

  useEffect(() => {
    if (task) useAgentStore.getState().upsertAgent(task);
  }, [task]);

  // Initialise a fresh agent session once per agent. Lifted to the parent so
  // every tab that mounts a chat (Overview, Chat) shares one session
  // and tab-switches don't reset chat state.
  const sessionInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!task) return;
    if (sessionInitRef.current === task.agent_id) return;
    sessionInitRef.current = task.agent_id;
    useSessionStore.getState().startNewAgentSession(task.agent_id);
    useAgentStore.getState().setActiveAgent(task.agent_id, task.collection_ids);
  }, [task?.agent_id, task?.collection_ids]);

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
    if (!(await confirmAgentRun(task.title))) return;
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

  const handleResume = async () => {
    if (!task) return;
    try {
      await resumeAgent(task.agent_id);
      toast.success('Resuming agent');
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
      fetchAgents();
    } catch (e) {
      // Surface server-provided `detail` so 4xx reasons are visible to the user.
      let msg = 'Failed to resume agent';
      if (e && typeof e === 'object' && 'body' in e && typeof (e as { body?: unknown }).body === 'string') {
        try {
          const parsed = JSON.parse((e as { body: string }).body);
          if (parsed?.detail) msg = String(parsed.detail);
        } catch {
          // body wasn't JSON - leave default
        }
      }
      toast.error(msg);
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

  // The agent has fully resolved as missing only when the query is no longer
  // loading and still has no data (placeholderData from the store didn't hit
  // either). Show the not-found UI in that case.
  if (!task && !isLoading) {
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

  const canRun = !!task && RUNNABLE_STATUSES.includes(task.status) && task.status !== 'running';

  // Shared between the desktop <aside> and the mobile off-canvas drawer so the
  // sidebar behaves identically in both; `isMobile` is layered on for the drawer.
  const sidebarProps = {
    activeAgent: task,
    activeTab,
    onTabChange: setActiveTab,
    hasCollections: (task?.collection_ids?.length ?? 0) > 0,
    onRun: handleRun,
    onStop: handleStop,
    onResume: handleResume,
    onPauseResume: handlePauseResume,
    onOpenSchedule: () => setScheduleOpen(true),
    agentSessions,
    activeSessionId,
    onSessionSelect: handleSessionSelect,
    onNewChat: handleNewChat,
    agentLayouts,
    activeLayoutId,
    onLayoutSelect: handleLayoutSelect,
    onNewLayout: handleNewLayout,
  };

  return (
    <div className="flex h-dvh bg-background">
      {/* Unified sidebar - desktop only; becomes the drawer on mobile */}
      <aside
        className="hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar md:block"
        style={{ width: sidebarCollapsed ? 48 : 280 }}
      >
        <AppSidebar {...sidebarProps} />
      </aside>

      <MobileSidebar>
        <AppSidebar {...sidebarProps} isMobile />
      </MobileSidebar>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHeader title={task?.title} />
        {/* Tab content - wait for task before mounting tabs (each tab assumes a
            non-null task). The sidebar renders independently above. */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {!task ? (
            <TabFallback />
          ) : (
            <Suspense fallback={<TabFallback />}>
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
                />
              )}
              {activeTab === 'settings' && (
                <AgentSettingsTab
                  task={task}
                  artifacts={artifacts}
                  logs={logs}
                  onTabChange={setActiveTab}
                  onOpenSchedule={() => setScheduleOpen(true)}
                  onRun={handleRun}
                  onStop={handleStop}
                  onResume={handleResume}
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
              {activeTab === 'chat' && (
                <AgentChatTab
                  task={task}
                  artifacts={artifacts}
                  agentSessions={agentSessions}
                  activeSessionId={activeSessionId}
                  onSessionSelect={handleSessionSelect}
                  onNewChat={handleNewChat}
                  onTabChange={setActiveTab}
                  onRun={handleRun}
                  onStop={handleStop}
                  onOpenSchedule={() => setScheduleOpen(true)}
                  canRun={canRun}
                />
              )}
              {activeTab === 'data' && (
                <AgentCollectionsTab task={task} artifacts={artifacts} />
              )}
              {activeTab === 'artifacts' && (
                <AgentArtifactsTab task={task} artifacts={artifacts} />
              )}
              {activeTab === 'explorer' && (
                <AgentExplorerTab
                  task={task}
                  activeLayoutId={activeLayoutId}
                  startInEditMode={startInEditMode}
                />
              )}
              {activeTab === 'alerts' && <AgentWatchesTab task={task} />}
            </Suspense>
          )}
        </main>
        {/* Mobile: agent tabs docked at the bottom */}
        <MobileTabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasCollections={(task?.collection_ids?.length ?? 0) > 0}
          agentSessions={agentSessions}
          activeSessionId={activeSessionId}
          onSessionSelect={handleSessionSelect}
          onNewChat={handleNewChat}
          agentLayouts={agentLayouts}
          activeLayoutId={activeLayoutId}
          onLayoutSelect={handleLayoutSelect}
          onNewLayout={handleNewLayout}
        />
      </div>

      {task && <ScheduleDialog task={task} open={scheduleOpen} onOpenChange={setScheduleOpen} />}

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
