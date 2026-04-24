import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Agent, Briefing } from '../../../../api/endpoints/agents.ts';
import { getAgentTopics } from '../../../../api/endpoints/topics.ts';
import { getAgentArtifacts, listAgentRuns } from '../../../../api/endpoints/agents.ts';
import { useSessionStore } from '../../../../stores/session-store.ts';
import { useAgentStore } from '../../../../stores/agent-store.ts';
import { TopicsFeed } from '../../../studio/TopicsFeed.tsx';
import { StudioActionsPanel } from '../../../studio/StudioActionsPanel.tsx';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { AnalyticsStrip } from '../../../collections/AnalyticsStrip.tsx';
import { useAgentAnalyticsStats } from '../useAgentAnalyticsStats.ts';
import { StatusBadge } from '../agent-status-utils.tsx';
import { Card } from '../../../../components/ui/card.tsx';
import { Logo } from '../../../../components/Logo.tsx';
import { Markdown } from '../../../../components/Markdown.tsx';
import { AgentArtifactsSidebar } from '../AgentArtifactsSidebar.tsx';

interface AgentTopicsTabProps {
  task: Agent;
}

export function AgentTopicsTab({ task }: AgentTopicsTabProps) {
  const agentId = task.agent_id;
  const initRef = useRef<string | null>(null);
  const [, setSearchParams] = useSearchParams();

  const { data: topics } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  // Shared queryKey with useAgentDetail — React Query dedupes.
  const { data: artifacts = [] } = useQuery({
    queryKey: ['agent-artifacts', agentId],
    queryFn: () => getAgentArtifacts(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  const hasTopics = !!topics && topics.length > 0;

  // Latest run briefing — used to seed the chat kickoff message when available.
  const { data: runs } = useQuery({
    queryKey: ['agent-runs', agentId, 5],
    queryFn: () => listAgentRuns(agentId, 5),
    enabled: !!agentId,
    staleTime: 30_000,
  });

  const latestBriefing = useMemo<Briefing | null>(() => {
    if (!runs) return null;
    const found = runs.find(
      (r) =>
        r.briefing &&
        (r.briefing.state_of_the_world?.trim() ||
          r.briefing.open_threads?.trim() ||
          r.briefing.process_notes?.trim()),
    );
    return found?.briefing ?? null;
  }, [runs]);

  // Initialise a fresh agent session so the embedded chat starts clean and
  // the next send is scoped to this agent. The kickoff message below is
  // presentational only — a session is not created until the user engages.
  useEffect(() => {
    if (!agentId) return;
    if (initRef.current === agentId) return;
    initRef.current = agentId;
    useSessionStore.getState().startNewAgentSession(agentId);
    useAgentStore.getState().setActiveAgent(agentId, task.collection_ids);
  }, [agentId, task.collection_ids]);

  const analyticsStats = useAgentAnalyticsStats(task);

  const kickoffMarkdown = useMemo(
    () => buildKickoffMarkdown(task, latestBriefing),
    [task, latestBriefing],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-3 px-6">
        <h1 className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{task.title}</h1>
        <StatusBadge status={task.status} />
        {hasTopics && (
          <span className="text-[11px] text-muted-foreground">
            {topics!.length} topic{topics!.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <AnalyticsStrip stats={analyticsStats} />
      <div className="flex-1 overflow-y-auto bg-muted">
        <div className="mx-2.5 mt-3 flex h-[320px] gap-2.5">
          <Card className="flex flex-[7] flex-col overflow-hidden bg-background p-0">
            <ChatPanel hideHeader emptyStateContent={<KickoffMessage markdown={kickoffMarkdown} />} />
          </Card>
          <Card className="flex-[3] overflow-y-auto bg-background p-3">
            <StudioActionsPanel />
          </Card>
        </div>
        <div className="flex gap-2.5 pr-2.5">
          <div className="min-w-0 flex-[7]">
            <TopicsFeed agentId={agentId} />
          </div>
          <div className="min-w-0 flex-[3] pt-3">
            <AgentArtifactsSidebar
              artifacts={artifacts}
              onViewAll={() => setSearchParams({ tab: 'artifacts' }, { replace: true })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function buildKickoffMarkdown(task: Agent, briefing: Briefing | null): string {
  // Prefer briefing's state_of_the_world when present — it's the agent's own
  // short view of where things stand. Prepend a dated heading so the message
  // reads as a proper briefing entry.
  const stateOfWorld = briefing?.state_of_the_world?.trim();
  if (stateOfWorld) {
    const heading = briefing?.generated_at
      ? `## Last brief · ${formatBriefingDate(briefing.generated_at)}`
      : `## Last brief`;
    return `${heading}\n\n${stateOfWorld}`;
  }

  // Fallbacks keyed on status / paused — no heading, already a one-liner.
  if (task.paused) {
    return `I'm paused right now. Resume me when you're ready, or ask me anything about **${task.title}**.`;
  }
  switch (task.status) {
    case 'running':
      return `I'm still gathering data on **${task.title}**. Ask me anything in the meantime — I'll use what I have so far.`;
    case 'failed':
      return `My last run hit an issue. Ask me to retry, or dig into what went wrong with **${task.title}**.`;
    case 'archived':
      return `This agent is archived, but I still have everything I collected. Ask me anything about **${task.title}**.`;
    case 'success':
    default:
      return `Ready when you are. Ask me anything about **${task.title}** — findings, trends, or what to look at next.`;
  }
}

function formatBriefingDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} · ${time}`;
}

function KickoffMessage({ markdown }: { markdown: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <Logo size="sm" showText={false} />
      </div>
      <Markdown
        autoDir
        className="agent-prose min-w-0 flex-1 break-words text-[13px] text-muted-foreground"
        stripComments={false}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
