import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
} from 'lucide-react';
import type { AgentLogEntry } from '../../../api/endpoints/agents.ts';
import { TOOL_DISPLAY_NAMES, TOOL_CATEGORY } from '../../../lib/constants.ts';
import { Button } from '../../../components/ui/button.tsx';

// ── Helpers ──────────────────────────────────────────────────────────

function formatLogTime(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Category colors (same palette as chat ActivityBar) ──────────────

type EntryType = NonNullable<AgentLogEntry['metadata']>['entry_type'];

function bulletColor(entryType: EntryType, toolName?: string): string {
  if (entryType === 'thinking') return 'bg-accent-vibrant/60';
  if (entryType === 'text') return 'bg-muted-foreground/40';
  if (entryType === 'tool_error') return 'bg-destructive';
  if (entryType === 'todo_update') return 'bg-accent-success';

  // tool_start / tool_complete — color by category
  const cat = toolName ? TOOL_CATEGORY[toolName] : undefined;
  const isComplete = entryType === 'tool_complete';
  if (cat === 'thinking') return isComplete ? 'bg-emerald-600/80' : 'bg-emerald-600/50 animate-pulse';
  if (cat === 'tools') return isComplete ? 'bg-amber-500' : 'bg-amber-400 animate-pulse';
  if (cat === 'outputs') return isComplete ? 'bg-emerald-600/80' : 'bg-emerald-600/50 animate-pulse';
  return isComplete ? 'bg-accent-success' : 'bg-muted-foreground animate-pulse';
}

function textColor(entryType: EntryType, toolName?: string): string {
  if (entryType === 'thinking') return 'text-foreground/55';
  if (entryType === 'text') return 'text-muted-foreground/60';
  if (entryType === 'tool_error') return 'text-destructive';
  if (entryType === 'todo_update') return 'text-accent-success';

  const cat = toolName ? TOOL_CATEGORY[toolName] : undefined;
  const isComplete = entryType === 'tool_complete';
  if (cat === 'thinking') return isComplete ? 'text-emerald-600/80' : 'text-emerald-600/60';
  if (cat === 'tools') return isComplete ? 'text-amber-500' : 'text-amber-400';
  if (cat === 'outputs') return isComplete ? 'text-emerald-600/80' : 'text-emerald-600/60';
  return isComplete ? 'text-accent-success' : 'text-muted-foreground';
}

// ── Entry rendering ─────────────────────────────────────────────────

function ToolDescription({ text }: { text: string }) {
  return (
    <div className="text-[11px] text-muted-foreground/60 leading-relaxed pl-3 line-clamp-2 font-normal">
      {text}
    </div>
  );
}

function renderStructuredEntry(log: AgentLogEntry) {
  const meta = log.metadata;
  const entryType = meta?.entry_type;
  const toolName = meta?.tool_name;
  const description = meta?.description as string | undefined;
  const displayName = toolName
    ? (TOOL_DISPLAY_NAMES[toolName] || toolName.replace(/_/g, ' '))
    : log.message;

  switch (entryType) {
    case 'tool_start':
      return (
        <div className="flex flex-col">
          <span>
            <span className="font-semibold">{displayName}</span>
            <span className="ml-0.5 font-normal">...</span>
          </span>
          {description && <ToolDescription text={description} />}
        </div>
      );

    case 'tool_complete':
      return (
        <div className="flex flex-col">
          <span>
            <span className="font-semibold">{displayName}</span>
            {meta?.duration_ms ? (
              <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                {formatDuration(meta.duration_ms)}
              </span>
            ) : null}
          </span>
          {description && <ToolDescription text={description} />}
        </div>
      );

    case 'tool_error':
      return (
        <div className="flex flex-col">
          <span>
            <span className="font-semibold">{displayName}</span>
            {meta?.error && (
              <span className="ml-1.5 text-[11px] font-normal"> — {meta.error}</span>
            )}
          </span>
        </div>
      );

    case 'thinking':
      return (
        <div className="flex flex-col">
          <span className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-3">
            {meta?.full_text || log.message}
          </span>
        </div>
      );

    case 'text':
      return (
        <span className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-2">
          {meta?.full_text || log.message}
        </span>
      );

    case 'todo_update':
      return (
        <span>
          <span className="font-medium">Plan updated</span>
        </span>
      );

    default:
      // Legacy flat log entry
      return <span>{log.message}</span>;
  }
}

// ── Main component ──────────────────────────────────────────────────

interface AgentActivityLogProps {
  logs: AgentLogEntry[];
  isRunning: boolean;
  /** Max entries to show before "Show all" (default 8) */
  initialLimit?: number;
}

export function AgentActivityLog({ logs, isRunning, initialLimit = 8 }: AgentActivityLogProps) {
  const [showAll, setShowAll] = useState(false);

  if (logs.length === 0) {
    return <p className="text-xs text-muted-foreground/50 italic">No activity recorded yet</p>;
  }

  const dedupedLogs = deduplicateLogs(logs);
  const logsToShow = showAll ? dedupedLogs : dedupedLogs.slice(0, initialLimit);

  return (
    <>
      <div className="space-y-0.5">
        {logsToShow.map((log, i) => {
          const isLatest = i === 0 && isRunning;
          const entryType = log.metadata?.entry_type;
          const isStructured = !!entryType;
          const isThinking = entryType === 'thinking';
          const toolName = log.metadata?.tool_name;

          return (
            <div key={log.id} className="flex items-start gap-2 py-1">
              {/* Bullet */}
              {isStructured ? (
                <div className="mt-[5px] shrink-0 relative">
                  <div
                    className={`${isThinking ? 'h-1.5 w-1.5' : 'h-2 w-2'} rounded-full ${bulletColor(entryType, toolName)}`}
                  />
                </div>
              ) : isLatest ? (
                <CircleDot className="h-3 w-3 mt-0.5 shrink-0 animate-pulse text-accent-vibrant/70" />
              ) : (
                <Check className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/40" strokeWidth={2.5} />
              )}

              {/* Content */}
              <div
                className={`flex-1 min-w-0 text-xs leading-snug ${
                  isStructured
                    ? textColor(entryType, toolName)
                    : isLatest
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground/60'
                }`}
              >
                {isStructured ? renderStructuredEntry(log) : log.message}
              </div>

              {/* Timestamp */}
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
                {formatLogTime(log.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
      {dedupedLogs.length > initialLimit && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 text-xs"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show all ${dedupedLogs.length}`}
          {showAll ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
        </Button>
      )}
    </>
  );
}

/** Deduplicate consecutive logs with the same message (keeps the most recent). */
function deduplicateLogs(logs: AgentLogEntry[]): AgentLogEntry[] {
  const result: AgentLogEntry[] = [];
  for (const log of logs) {
    if (result.length > 0 && result[result.length - 1].message === log.message) continue;
    result.push(log);
  }
  return result;
}

/** Compact variant for overview cards — shows fewer entries, no expand button. */
export function AgentActivityLogCompact({ logs, isRunning, limit = 4 }: { logs: AgentLogEntry[]; isRunning: boolean; limit?: number }) {
  if (logs.length === 0) return null;
  const dedupedLogs = deduplicateLogs(logs);

  return (
    <div className="divide-y divide-border/40">
      {dedupedLogs.slice(0, limit).map((log, i) => {
        const isLatest = i === 0 && isRunning;
        const entryType = log.metadata?.entry_type;
        const isStructured = !!entryType;
        const isThinking = entryType === 'thinking';
        const toolName = log.metadata?.tool_name;

        return (
          <div key={log.id} className="flex items-start gap-2 px-3 py-2">
            <div className="mt-0.5 shrink-0">
              {isStructured ? (
                <div
                  className={`${isThinking ? 'h-1.5 w-1.5 mt-[1px]' : 'h-2 w-2'} rounded-full ${bulletColor(entryType, toolName)}`}
                />
              ) : isLatest ? (
                <CircleDot className="h-3 w-3 animate-pulse text-primary" />
              ) : (
                <Check className="h-3 w-3 text-muted-foreground/30" strokeWidth={2.5} />
              )}
            </div>
            <span
              className={`flex-1 text-[11px] leading-snug ${
                isStructured
                  ? textColor(entryType, toolName)
                  : isLatest
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
              }`}
            >
              {isStructured ? renderStructuredEntry(log) : log.message}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground/40 tabular-nums">
              {formatLogTime(log.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
