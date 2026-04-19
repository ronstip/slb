import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { useCollectionsSync } from '../collections/useCollectionsSync.ts';
import { Logo } from '../../components/Logo.tsx';
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { GeometricMesh } from '../../components/BrandElements.tsx';
import { AgentCreationWizard } from './wizard/AgentCreationWizard.tsx';
import { LatestAgentsRow } from './LatestAgentsRow.tsx';
import { ChatPanel } from '../chat/ChatPanel.tsx';

const SIDEBAR_COLLAPSED_W = 48;
const SIDEBAR_EXPANDED_W = 280;

export function AgentHome() {
  const agents = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const messages = useChatStore((s) => s.messages);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const createMode = searchParams.get('create') === '1';

  const firstName =
    (profile?.display_name ?? user?.displayName ?? '').trim().split(/\s+/)[0] || 'there';
  const activeAgents = agents.filter(
    (a) => a.status === 'running' || (a.agent_type === 'recurring' && !a.paused && a.status !== 'archived'),
  ).length;

  useCollectionsSync();

  useEffect(() => {
    // Clear any leftover chat state from a previous creation flow so returning
    // to AgentHome (via logo or "+ New Agent") always shows the wizard, not
    // a stale chat. Skip if a stream is actively running mid-creation.
    if (!useChatStore.getState().isAgentResponding) {
      useChatStore.getState().clearMessages();
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const hasAgents = agents.length > 0;
  // Show chat panel when the wizard has kicked off a session (agent is responding
  // or has already replied — e.g. with an ask_user approval prompt).
  const hasChatActivity = messages.length > 0 || isAgentResponding;

  return (
    <div className="flex h-screen bg-background">
      <aside
        className="shrink-0 overflow-hidden"
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
      >
        <AppSidebar />
      </aside>

      {/* Wizard — always keep mounted so AgentCreationWizard's useSSEChat stream is
          not aborted when we switch to the chat view. Just hide it visually. */}
      <main
        className={`${hasChatActivity ? 'hidden' : 'flex'} relative flex-1 flex-col items-center overflow-y-auto px-6 py-8`}
      >
        <GeometricMesh />

        {/* Loading state */}
        {isLoading && agents.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {/* Content */}
        {(!isLoading || agents.length > 0) && (
          <div className="relative z-10 w-full max-w-[1200px]">
            {hasAgents && !createMode && (
              <section className="mb-8">
                <h1 className="mb-2 font-heading text-3xl font-bold tracking-tight text-foreground">
                  Welcome back, {firstName}.
                </h1>
                <p className="text-sm text-muted-foreground">
                  You have{' '}
                  <strong className="font-medium text-primary">
                    {activeAgents} {activeAgents === 1 ? 'agent' : 'agents'}
                  </strong>{' '}
                  actively listening across the web.
                </p>
              </section>
            )}

            {!hasAgents && !createMode && (
              <div className="mb-8 flex flex-col items-center text-center">
                <Logo size="lg" showText={false} />
                <h2 className="mt-3 font-heading text-2xl font-bold tracking-tight text-foreground">
                  Welcome to Veille
                </h2>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary/60" />
                  Set up your first monitoring agent in three simple steps
                </p>
              </div>
            )}

            {hasAgents && !createMode && (
              <div className="mb-8">
                <LatestAgentsRow tasks={agents} />
              </div>
            )}

            <div className="mb-4">
              <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
                Create a New Agent
              </h2>
              <p className="text-xs text-muted-foreground">
                Define what to monitor, configure collection settings, and set the schedule
              </p>
            </div>

            <AgentCreationWizard />
          </div>
        )}
      </main>

      {/* Chat panel — shown once the wizard submits and the stream is live.
          The wizard above stays mounted (hidden) to keep its useSSEChat stream alive.
          ChatPanel handles user follow-up messages (e.g. approving the ask_user prompt). */}
      {hasChatActivity && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center border-b border-border px-6">
            <span className="font-heading text-sm font-semibold text-foreground">Creating Agent…</span>
          </div>
          <ChatPanel hideHeader />
        </div>
      )}
    </div>
  );
}
