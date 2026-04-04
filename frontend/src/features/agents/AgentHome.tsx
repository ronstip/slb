import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useCollectionsSync } from '../collections/useCollectionsSync.ts';
import { Logo } from '../../components/Logo.tsx';
import { AppSidebar } from '../../components/AppSidebar.tsx';
import { AgentCreationWizard } from './wizard/AgentCreationWizard.tsx';
import { LatestAgentsRow } from './LatestAgentsRow.tsx';

const SIDEBAR_COLLAPSED_W = 48;
const SIDEBAR_EXPANDED_W = 280;

export function AgentHome() {
  const agents = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const sidebarCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);

  useCollectionsSync();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const hasAgents = agents.length > 0;

  return (
    <div className="flex h-screen bg-background">
      <aside
        className="shrink-0 overflow-hidden border-r border-border bg-white dark:bg-[#0B1120]"
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
      >
        <AppSidebar />
      </aside>

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
        {/* Loading state */}
        {isLoading && agents.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {/* Content */}
        {(!isLoading || agents.length > 0) && (
          <div className="w-full max-w-[1200px]">
            {!hasAgents && (
              <div className="mb-8 flex flex-col items-center text-center">
                <Logo size="lg" showText={false} />
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                  Welcome to Veille
                </h2>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary/60" />
                  Set up your first monitoring agent in three simple steps
                </p>
              </div>
            )}

            {hasAgents && (
              <div className="mb-6">
                <LatestAgentsRow tasks={agents} />
              </div>
            )}

            {hasAgents && (
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-foreground">Create a New Agent</h2>
                <p className="text-xs text-muted-foreground">
                  Define what to monitor, configure collection settings, and set the schedule
                </p>
              </div>
            )}

            <AgentCreationWizard />
          </div>
        )}
      </main>
    </div>
  );
}
