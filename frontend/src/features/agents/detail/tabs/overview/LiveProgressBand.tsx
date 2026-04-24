import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Play, RotateCcw } from 'lucide-react';
import type { Agent } from '../../../../../api/endpoints/agents.ts';
import { cn } from '../../../../../lib/utils.ts';
import { timeAgo } from '../../../../../lib/format.ts';

interface LiveProgressBandProps {
  task: Agent;
  onRun?: () => void;
  onGoToBriefing: () => void;
}

function useElapsed(startIso: string | undefined, active: boolean): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  if (!startIso) return '';
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function LiveProgressBand({ task, onRun, onGoToBriefing }: LiveProgressBandProps) {
  const todos = task.todos ?? [];
  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const currentStep = todos.find((t) => t.status === 'in_progress');
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const isRunning = task.status === 'running';
  const elapsed = useElapsed(task.updated_at, isRunning);

  if (isRunning) {
    return (
      <div className="shrink-0 border-b border-border/40 bg-gradient-to-r from-amber-50/40 via-transparent to-transparent dark:from-amber-500/5">
        <div className="px-6 py-3 flex items-center gap-4">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 text-sm min-w-0">
              <span className="font-medium text-foreground shrink-0">
                Step {Math.min(completed + 1, Math.max(total, 1))} of {total || '?'}
              </span>
              {currentStep && (
                <span className="text-muted-foreground truncate">— {currentStep.content}</span>
              )}
            </div>
            {total > 0 && (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
            Running {elapsed}
          </div>
        </div>
      </div>
    );
  }

  if (task.status === 'success') {
    return (
      <div className="shrink-0 border-b border-border/40 bg-gradient-to-r from-emerald-50/40 via-transparent to-transparent dark:from-emerald-500/5">
        <div className="px-6 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-foreground">Complete</span>
            {task.updated_at && (
              <span className="ml-2 text-muted-foreground">
                · finished {timeAgo(task.updated_at)}
              </span>
            )}
          </div>
          <button
            onClick={onGoToBriefing}
            className="shrink-0 text-xs font-medium text-primary hover:text-primary/80"
          >
            Read the briefing →
          </button>
        </div>
      </div>
    );
  }

  if (task.status === 'failed') {
    return (
      <div className="shrink-0 border-b border-destructive/30 bg-destructive/5">
        <div className="px-6 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-destructive">Run failed</span>
            <span className="ml-2 text-muted-foreground text-xs">
              Check the Settings → Logs tab for details.
            </span>
          </div>
          {onRun && (
            <button
              onClick={onRun}
              className="shrink-0 flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Idle / archived
  return (
    <div className="shrink-0 border-b border-border/40 bg-muted/30">
      <div className="px-6 py-3 flex items-center gap-3">
        <span className={cn('h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40')} />
        <div className="flex-1 min-w-0 text-sm text-muted-foreground">
          Ready to run — kick off a run to see live progress here.
        </div>
        {onRun && (
          <button
            onClick={onRun}
            className="shrink-0 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Play className="h-3 w-3 fill-current" /> Run now
          </button>
        )}
      </div>
    </div>
  );
}
