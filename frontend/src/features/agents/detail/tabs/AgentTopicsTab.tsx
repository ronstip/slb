import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import type { Agent, Briefing } from '../../../../api/endpoints/agents.ts';
import { listAgentRuns } from '../../../../api/endpoints/agents.ts';
import { getAgentTopics } from '../../../../api/endpoints/topics.ts';
import { TopicsFeed } from '../../../studio/TopicsFeed.tsx';
import { TopicsQuadrant } from '../../../studio/TopicsQuadrant.tsx';
import { AnalyticsStrip } from '../../../collections/AnalyticsStrip.tsx';
import { useAgentAnalyticsStats } from '../useAgentAnalyticsStats.ts';
import { StatusBadge } from '../agent-status-utils.tsx';
import { Card } from '../../../../components/ui/card.tsx';

interface AgentTopicsTabProps {
  task: Agent;
}

export function AgentTopicsTab({ task }: AgentTopicsTabProps) {
  const agentId = task.agent_id;
  // Shared with TopicsFeed via the same query key — React Query dedupes.
  const { data: topics } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  const hasTopics = !!topics && topics.length > 0;
  const showQuadrant = !!topics && topics.length >= 3;

  // Latest run's per-run briefing (state_of_the_world / open_threads / process_notes),
  // written by the agent's generate_briefing tool and stored on the run doc.
  const { data: runs, isLoading: isRunsLoading } = useQuery({
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

  const analyticsStats = useAgentAnalyticsStats(task);

  const handleTopicSelect = useCallback((clusterId: string) => {
    const el = document.getElementById(`topic-card-${clusterId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary/60', 'rounded-lg');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-primary/60', 'rounded-lg');
    }, 1600);
  }, []);

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
        {hasTopics && (
          <div className={`mx-2.5 mt-3 grid items-start gap-2.5 ${showQuadrant ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            <BriefingCard briefing={latestBriefing} isLoading={isRunsLoading} />
            {showQuadrant && (
              <TopicsQuadrant topics={topics!} onTopicSelect={handleTopicSelect} />
            )}
          </div>
        )}
        <TopicsFeed agentId={agentId} />
      </div>
    </div>
  );
}

interface BriefingCardProps {
  briefing: Briefing | null;
  isLoading: boolean;
}

function composeBriefingMarkdown(b: Briefing): string {
  const parts: string[] = [];
  if (b.state_of_the_world?.trim()) {
    parts.push('## State of the world');
    parts.push(b.state_of_the_world.trim());
  }
  if (b.open_threads?.trim()) {
    parts.push('## Open threads');
    parts.push(b.open_threads.trim());
  }
  if (b.process_notes?.trim()) {
    parts.push('## Process notes');
    parts.push(b.process_notes.trim());
  }
  return parts.join('\n\n');
}

function BriefingCard({ briefing, isLoading }: BriefingCardProps) {
  const markdown = useMemo(
    () => (briefing ? composeBriefingMarkdown(briefing) : ''),
    [briefing],
  );

  return (
    <Card className="flex h-[280px] flex-col overflow-hidden bg-background px-4 py-3.5 !gap-2">
      <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        <Sparkles className="h-3 w-3" />
        Briefing
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-secondary" />
          <div className="h-3 w-full animate-pulse rounded bg-secondary" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
        </div>
      ) : markdown ? (
        <div className="flex-1 overflow-y-auto prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-h2:text-[15px] prose-h2:font-semibold prose-h2:leading-snug prose-h2:mt-0 prose-h3:text-[13px] prose-h3:font-semibold prose-p:text-muted-foreground prose-p:text-[12px] prose-p:leading-relaxed prose-li:text-muted-foreground prose-li:text-[12px] prose-strong:text-foreground prose-a:text-primary prose-blockquote:text-muted-foreground prose-blockquote:text-[12px] prose-blockquote:italic prose-blockquote:border-l-foreground/30 prose-hr:my-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">No briefing yet.</p>
      )}
    </Card>
  );
}
