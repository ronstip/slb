import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { useCollectionsSync } from '../collections/useCollectionsSync.ts';
import { Logo, BRAND_NAME } from '../../components/Logo.tsx';
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { MobileHeader } from '../../components/MobileHeader.tsx';
import { MobileSidebar } from '../../components/MobileSidebar.tsx';
import { UtilityTopBar } from '../../components/BrandElements.tsx';
import { AgentCreationWizard } from './wizard/AgentCreationWizard.tsx';
import { LatestAgentsRow } from './LatestAgentsRow.tsx';
import { NewAgentDrawer } from './NewAgentDrawer.tsx';
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { ErrorBoundary } from '../../components/ErrorBoundary.tsx';

const SIDEBAR_COLLAPSED_W = 48;
const SIDEBAR_EXPANDED_W = 280;

function formatToday(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  const day = d.getDate();
  return `${weekday}, ${month} ${day}`;
}

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
      {/* Desktop sidebar — hidden on mobile, where it becomes the drawer below */}
      <aside
        className="hidden shrink-0 overflow-hidden md:block"
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
      >
        <AppSidebar />
      </aside>

      {/* Mobile off-canvas navigation */}
      <MobileSidebar>
        <AppSidebar isMobile />
      </MobileSidebar>

      <div className="flex min-w-0 flex-1 flex-col">
      <MobileHeader />

      {/* Wizard — always keep mounted so AgentCreationWizard's useSSEChat stream is
          not aborted when we switch to the chat view. Just hide it visually. */}
      <main
        className={`${hasChatActivity ? 'hidden' : 'flex'} relative flex-1 flex-col items-center overflow-y-auto px-4 py-6 md:px-8 md:py-8`}
      >
        {/* Loading state */}
        {isLoading && agents.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {/* Content */}
        {(!isLoading || agents.length > 0) && (
          <div className="relative z-10 w-full">
            {/* Top eyebrow line — date + theme/notifications */}
            {hasAgents && !createMode && (
              <div className="mb-6">
                <UtilityTopBar><span>{formatToday()}</span></UtilityTopBar>
              </div>
            )}

            {hasAgents && !createMode && (
              <section className="mb-10">
                <h1 className="font-serif text-4xl font-normal leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                  Welcome back,{' '}
                  <span className="italic text-primary">{firstName}.</span>
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  You have{' '}
                  <strong className="font-medium text-primary">
                    {activeAgents} {activeAgents === 1 ? 'agent' : 'agents'}
                  </strong>{' '}
                  actively listening across the web.
                </p>
              </section>
            )}

            {!hasAgents && !createMode && (
              <div className="mb-10 flex flex-col items-center text-center">
                <Logo size="lg" showText={false} />
                <h2 className="mt-4 font-serif text-4xl font-normal tracking-tight text-foreground">
                  Welcome to <span className="italic text-primary">{BRAND_NAME}</span>
                </h2>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary/60" />
                  Set up your first monitoring agent in three simple steps
                </p>
              </div>
            )}

            {hasAgents && !createMode && (
              <div className="mb-10">
                <LatestAgentsRow tasks={agents} />
              </div>
            )}

            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="flex flex-wrap items-baseline gap-x-4 font-serif text-3xl font-normal leading-tight tracking-tight text-foreground sm:text-4xl">
                <span>
                  Create a <span className="italic text-primary">new agent</span>
                </span>
                <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 1 of 3
                </span>
              </h2>
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
          <ErrorBoundary label="ChatPanel">
            <ChatPanel hideHeader />
          </ErrorBoundary>
        </div>
      )}
      </div>

      {/* Home route is rendered outside AuthGate, so mount the drawer here
          too — without it, the sidebar's "New agent" button no-ops on /. */}
      <NewAgentDrawer />
    </div>
  );
}
