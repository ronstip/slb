import { memo, useMemo } from 'react';
import { ChevronRight, History } from 'lucide-react';
import type { AgentRun } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { formatDate } from '../agent-status-utils.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu.tsx';
import { ARTIFACT_STYLES } from '../../../artifacts/artifact-utils.ts';
import { cn } from '../../../../lib/utils.ts';

const TRIGGER_LABELS: Record<string, string> = {
  wizard: 'Wizard',
  manual: 'Manual',
  scheduled: 'Scheduled',
};

const STATUS_DOT_COLOR: Record<string, string> = {
  running: 'bg-amber-500',
  success: 'bg-green-500',
  failed: 'bg-red-500',
};

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return '—';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

interface RunHistoryDropdownProps {
  runs: AgentRun[] | undefined;
  artifacts: ArtifactListItem[];
}

function RunHistoryDropdownImpl({ runs, artifacts }: RunHistoryDropdownProps) {
  // Oldest first → #1 is the oldest run, highest number is newest.
  const numberedRuns = useMemo(
    () => (runs ?? []).map((run, i, arr) => ({ ...run, number: arr.length - i })),
    [runs],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <History className="h-3 w-3" />
          Runs
          {numberedRuns.length > 0 && (
            <span className="ml-0.5 text-muted-foreground">{numberedRuns.length}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {numberedRuns.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No runs yet
          </DropdownMenuItem>
        ) : (
          numberedRuns.map((run) => {
            const runArtifacts = artifacts.filter((a) => run.artifact_ids.includes(a.artifact_id));
            const hasBriefing = run.briefing && (run.briefing.state_of_the_world || run.briefing.open_threads || run.briefing.process_notes);
            const hasDetails = hasBriefing || runArtifacts.length > 0;

            if (!hasDetails) {
              return (
                <DropdownMenuItem key={run.run_id} className="text-xs cursor-default">
                  <RunItemContent run={run} />
                </DropdownMenuItem>
              );
            }

            return (
              <DropdownMenuSub key={run.run_id}>
                <DropdownMenuSubTrigger className="text-xs">
                  <RunItemContent run={run} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-80 p-0">
                  <div className="max-h-96 overflow-y-auto">
                    <div className="px-3 py-2 border-b border-border/50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">Run #{run.number}</span>
                        <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT_COLOR[run.status] ?? 'bg-muted-foreground')} />
                        <span className="text-[11px] text-muted-foreground capitalize">{run.status}</span>
                        <span className="flex-1" />
                        <span className="text-[11px] text-muted-foreground">{formatDuration(run.started_at, run.completed_at)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(run.started_at)}</p>
                    </div>

                    {hasBriefing && (
                      <div className="px-3 py-2 space-y-2 border-b border-border/50">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Briefing</p>
                        {run.briefing!.state_of_the_world && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">State of the World</p>
                            <p className="text-xs text-foreground/80 leading-relaxed">{run.briefing!.state_of_the_world}</p>
                          </div>
                        )}
                        {run.briefing!.open_threads && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Open Threads</p>
                            <p className="text-xs text-foreground/80 leading-relaxed">{run.briefing!.open_threads}</p>
                          </div>
                        )}
                        {run.briefing!.process_notes && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Process Notes</p>
                            <p className="text-xs text-foreground/80 leading-relaxed">{run.briefing!.process_notes}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {runArtifacts.length > 0 && (
                      <div className="px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Artifacts</p>
                        {runArtifacts.map((artifact) => {
                          const style = ARTIFACT_STYLES[artifact.type] ?? ARTIFACT_STYLES.chart;
                          const Icon = style.icon;
                          return (
                            <a
                              key={artifact.artifact_id}
                              href={`/artifacts/${artifact.artifact_id}`}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                            >
                              <Icon className={cn('h-3.5 w-3.5 shrink-0', style.color)} />
                              <span className="truncate flex-1">{artifact.title}</span>
                              <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunItemContent({ run }: { run: AgentRun & { number: number } }) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="text-[11px] font-semibold text-muted-foreground w-6 shrink-0">#{run.number}</span>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT_COLOR[run.status] ?? 'bg-muted-foreground')} />
      <span className="text-xs truncate flex-1">{formatDate(run.started_at)}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">{TRIGGER_LABELS[run.trigger] ?? run.trigger}</span>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{formatDuration(run.started_at, run.completed_at)}</span>
    </div>
  );
}

export const RunHistoryDropdown = memo(RunHistoryDropdownImpl);
