import { useState } from 'react';
import { Activity, Maximize2, Minimize2 } from 'lucide-react';
import type { Agent, AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';
import { AgentActivityLogCompact } from '../AgentActivityLog.tsx';
import { LiveProgressBand } from './overview/LiveProgressBand.tsx';
import { LivePostStream } from './overview/LivePostStream.tsx';
import { DeliverablesPanel } from './overview/DeliverablesPanel.tsx';
import { EmergingTopicsPreview } from './overview/EmergingTopicsPreview.tsx';
import { EntitiesCard } from './overview/EntitiesCard.tsx';
import { ChannelMixCard } from './overview/ChannelMixCard.tsx';
import { TopicsMosaic } from './overview/TopicsMosaic.tsx';
import { TrendCard } from './overview/TrendCard.tsx';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { StudioActionsPanel } from '../../../studio/StudioActionsPanel.tsx';
import { useAgentKickoff, KickoffMessage } from '../kickoff.tsx';
import { useOpenBriefingShare } from '../../../briefings/use-open-briefing-share.ts';

interface AgentOverviewTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  logs: AgentLogEntry[];
  onTabChange: (tab: DetailTab) => void;
  onOpenSchedule: () => void;
  onRun?: () => void;
  onStop?: () => void;
  canRun?: boolean;
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
}: AgentOverviewTabProps) {
  const isRunning = task.status === 'running';
  const collectionIds = task.collection_ids ?? [];
  const [chatExpanded, setChatExpanded] = useState(false);
  const { kickoffMarkdown } = useAgentKickoff(task);
  const { open: openBriefing } = useOpenBriefingShare(task.agent_id, task.title);

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
        onGoToBriefing={() => { void openBriefing(); }}
      />

      <main className="flex-1 overflow-y-auto z-10 p-6 lg:p-8">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-8">
              <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
                <header className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Chat</h3>
                </header>
                <div
                  className={`relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card ${chatExpanded ? 'h-[640px]' : 'h-[320px]'}`}
                >
                  <button
                    type="button"
                    onClick={() => setChatExpanded((v) => !v)}
                    aria-label={chatExpanded ? 'Collapse chat' : 'Expand chat'}
                    className="absolute right-2 top-2 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {chatExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                  <ChatPanel hideHeader compact emptyStateContent={<KickoffMessage markdown={kickoffMarkdown} />} />
                </div>
              </section>
              <LivePostStream
                collectionIds={collectionIds}
                isAgentRunning={isRunning}
                searches={task.data_scope?.searches}
                onOpenData={() => onTabChange('data')}
              />
              <TrendCard
                agentId={task.agent_id}
                collectionIds={collectionIds}
                isAgentRunning={isRunning}
                customFields={task.data_scope?.custom_fields}
                searches={task.data_scope?.searches}
              />
              <TopicsMosaic
                agentId={task.agent_id}
                isAgentRunning={isRunning}
                onOpenTopics={() => onTabChange('topics')}
              />
            </div>
            <div className="space-y-4 lg:col-span-4">
              <section className="flex flex-col rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
                <header className="mb-3 flex items-center gap-2">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Actions</h3>
                </header>
                <div className="h-[320px] min-h-0">
                  <StudioActionsPanel
                    variant="overview"
                    customFields={task.data_scope?.custom_fields}
                  />
                </div>
              </section>
              <DeliverablesPanel
                task={task}
                artifacts={artifacts}
                onOpenArtifacts={() => onTabChange('artifacts')}
                onOpenBriefing={() => { void openBriefing(); }}
                onOpenSettings={() => onTabChange('settings')}
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
              <EntitiesCard
                collectionIds={collectionIds}
                isAgentRunning={isRunning}
                searches={task.data_scope?.searches}
                onOpenData={() => onTabChange('data')}
              />
              <ChannelMixCard
                collectionIds={collectionIds}
                isAgentRunning={isRunning}
                searches={task.data_scope?.searches}
                onOpenData={() => onTabChange('data')}
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
