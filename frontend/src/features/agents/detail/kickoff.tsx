import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Agent, Briefing } from '../../../api/endpoints/agents.ts';
import { listAgentRuns } from '../../../api/endpoints/agents.ts';
import { Logo } from '../../../components/Logo.tsx';
import { Markdown } from '../../../components/Markdown.tsx';

export function buildKickoffMarkdown(task: Agent, briefing: Briefing | null): string {
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

export function formatBriefingDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} · ${time}`;
}

export function KickoffMessage({ markdown }: { markdown: string }) {
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

export function useAgentKickoff(task: Agent): { kickoffMarkdown: string } {
  const agentId = task.agent_id;

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

  const kickoffMarkdown = useMemo(
    () => buildKickoffMarkdown(task, latestBriefing),
    [task, latestBriefing],
  );

  return { kickoffMarkdown };
}
