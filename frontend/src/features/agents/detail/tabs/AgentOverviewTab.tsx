import { Activity } from 'lucide-react';
import type { Agent, AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';
import { AgentActivityLogCompact } from '../AgentActivityLog.tsx';
import { LiveProgressBand } from './overview/LiveProgressBand.tsx';
import { LivePostStream } from './overview/LivePostStream.tsx';
import { DeliverablesPanel } from './overview/DeliverablesPanel.tsx';
import { EmergingTopicsPreview } from './overview/EmergingTopicsPreview.tsx';

interface AgentOverviewTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  logs: AgentLogEntry[];
  onTabChange: (tab: DetailTab) => void;
  onOpenSchedule: () => void;
  onRun?: () => void;
  onStop?: () => void;
  canRun?: boolean;
  onOpenLayout?: (layoutId: string | null) => void;
}

export function AgentOverviewTab({
  task,
  artifacts,
  logs,
  onTabChange,
  onOpenSchedule,
  onRun,
  onStop,
  canRun,
  onOpenLayout,
}: AgentOverviewTabProps) {
  const isRunning = task.status === 'running';
  const collectionIds = task.collection_ids ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0 relative">
      {/* Decorative background glow */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <AgentDetailHeader
        task={task}
        artifacts={artifacts}
        onRun={onRun}
        onStop={onStop}
        onOpenSchedule={onOpenSchedule}
        canRun={canRun}
        onGoToSettings={() => onTabChange('settings')}
      />

      <LiveProgressBand
        task={task}
        onRun={onRun}
        onGoToBriefing={() => onTabChange('briefing')}
      />

      <main className="flex-1 overflow-y-auto z-10 p-6 lg:p-8">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <LivePostStream
                collectionIds={collectionIds}
                isAgentRunning={isRunning}
                onOpenData={() => onTabChange('data')}
              />
            </div>
            <div className="lg:col-span-4 space-y-4">
              <DeliverablesPanel
                task={task}
                artifacts={artifacts}
                onOpenArtifacts={() => onTabChange('artifacts')}
                onOpenBriefing={() => onTabChange('briefing')}
                onOpenSettings={() => onTabChange('settings')}
                onOpenLayout={(id) => {
                  if (onOpenLayout) onOpenLayout(id);
                  else onTabChange('explorer');
                }}
              />
              <EmergingTopicsPreview
                agentId={task.agent_id}
                isAgentRunning={isRunning}
                onOpenTopics={() => onTabChange('topics')}
              />
              <ActivityCard
                logs={logs}
                isRunning={isRunning}
                onOpenLogs={() => onTabChange('settings')}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ActivityCard({
  logs,
  isRunning,
  onOpenLogs,
}: {
  logs: AgentLogEntry[];
  isRunning: boolean;
  onOpenLogs: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-sm font-semibold text-foreground">Activity</h3>
          {isRunning && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-pulse" />
          )}
        </div>
        <button
          onClick={onOpenLogs}
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          Full log →
        </button>
      </header>
      <div className="border-t border-border/40">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <Activity className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              {isRunning ? 'Waiting for first activity…' : 'No activity yet.'}
            </p>
          </div>
        ) : (
          <AgentActivityLogCompact logs={logs} isRunning={isRunning} limit={6} />
        )}
      </div>
    </section>
  );
}
