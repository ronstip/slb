import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { getAgentTopics } from '../../../../api/endpoints/topics.ts';
import { getAgentArtifacts } from '../../../../api/endpoints/agents.ts';
import { TopicsFeed } from '../../../studio/TopicsFeed.tsx';
import { StudioActionsPanel } from '../../../studio/StudioActionsPanel.tsx';
import { ChatPanel } from '../../../chat/ChatPanel.tsx';
import { AnalyticsStrip } from '../../../collections/AnalyticsStrip.tsx';
import { useAgentAnalyticsStats } from '../useAgentAnalyticsStats.ts';
import { StatusBadge } from '../agent-status-utils.tsx';
import { Card } from '../../../../components/ui/card.tsx';
import { AgentArtifactsSidebar } from '../AgentArtifactsSidebar.tsx';
import { useAgentKickoff, KickoffMessage } from '../kickoff.tsx';

interface AgentTopicsTabProps {
  task: Agent;
}

export function AgentTopicsTab({ task }: AgentTopicsTabProps) {
  const agentId = task.agent_id;
  const [, setSearchParams] = useSearchParams();
  const [chatExpanded, setChatExpanded] = useState(false);

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

  const analyticsStats = useAgentAnalyticsStats(task);

  const { kickoffMarkdown } = useAgentKickoff(task);

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
        <div className="flex items-start gap-2.5 pl-2.5 pr-2.5 pt-3">
          <div className="flex min-w-0 flex-[7] flex-col gap-2.5">
            <Card
              className={`relative flex flex-col overflow-hidden bg-background p-0 ${chatExpanded ? 'h-[640px]' : 'h-[320px]'}`}
            >
              <button
                type="button"
                onClick={() => setChatExpanded((v) => !v)}
                aria-label={chatExpanded ? 'Collapse chat' : 'Expand chat'}
                className="absolute right-2 top-2 z-10 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {chatExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <ChatPanel hideHeader emptyStateContent={<KickoffMessage markdown={kickoffMarkdown} />} />
            </Card>
            <TopicsFeed agentId={agentId} />
          </div>
          <div className="flex min-w-0 flex-[3] flex-col gap-2.5">
            <Card className="h-[320px] overflow-y-auto bg-background p-3">
              <StudioActionsPanel customFields={task.data_scope?.custom_fields} />
            </Card>
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
