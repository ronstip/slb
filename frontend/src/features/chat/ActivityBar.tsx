import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ActivityEntry, TodoItem } from '../../stores/chat-store.ts';

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Parse inline `code` and ```block``` from thinking text into React nodes. */
function renderThinkingText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Match fenced code blocks first, then inline code
  const re = /```(\w*)\n?([\s\S]*?)```|`([^`]+)`/g;
  let last = 0;
  let match;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    // Text before this match
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[2] !== undefined) {
      // Fenced code block
      nodes.push(
        <pre key={++key} className="my-1 rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px] leading-relaxed overflow-x-auto">
          <code>{match[2].trim()}</code>
        </pre>,
      );
    } else if (match[3] !== undefined) {
      // Inline code
      nodes.push(
        <code key={++key} className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
          {match[3]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

// ── Collapsed entries builder ────────────────────────────────────────

interface DisplayEntry {
  kind: ActivityEntry['kind'];
  text: string;
  toolName?: string;
  resolved?: boolean;
  durationMs?: number;
  error?: string;
  count: number; // > 1 means collapsed group
  todos?: TodoItem[];
}

function buildDisplayEntries(log: ActivityEntry[]): { entries: DisplayEntry[]; todos: TodoItem[] } {
  let lastTodos: TodoItem[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === 'todo_update' && (log[i].todos?.length ?? 0) > 0) {
      lastTodos = log[i].todos!;
      break;
    }
  }

  const nonTodo = log.filter((e) => e.kind !== 'todo_update');

  // Pass 1: count total occurrences of each resolved tool (no errors)
  const resolvedToolCounts = new Map<string, number>();
  for (const e of nonTodo) {
    if (e.kind === 'tool' && e.resolved && !e.error && e.toolName) {
      resolvedToolCounts.set(e.toolName, (resolvedToolCounts.get(e.toolName) ?? 0) + 1);
    }
  }

  // Pass 2: build display entries, collapsing resolved same-tool entries
  // For tools with multiple resolved calls, keep only the last occurrence
  // and show the total count. This handles non-consecutive duplicates too.
  const resolvedToolSeen = new Map<string, number>();
  const entries: DisplayEntry[] = [];

  // Find the last index of each resolved tool to place the collapsed entry there
  const lastResolvedIdx = new Map<string, number>();
  for (let i = nonTodo.length - 1; i >= 0; i--) {
    const e = nonTodo[i];
    if (e.kind === 'tool' && e.resolved && !e.error && e.toolName && !lastResolvedIdx.has(e.toolName)) {
      lastResolvedIdx.set(e.toolName, i);
    }
  }

  for (let i = 0; i < nonTodo.length; i++) {
    const entry = nonTodo[i];

    if (entry.kind === 'tool' && entry.resolved && !entry.error && entry.toolName) {
      const total = resolvedToolCounts.get(entry.toolName) ?? 1;
      const seen = (resolvedToolSeen.get(entry.toolName) ?? 0) + 1;
      resolvedToolSeen.set(entry.toolName, seen);

      if (total <= 1) {
        // Single occurrence — show normally
        entries.push({ ...entry, count: 1 });
      } else if (i === lastResolvedIdx.get(entry.toolName)) {
        // Last occurrence of a multi-call tool — show collapsed with total count
        entries.push({
          kind: 'tool',
          text: entry.text,
          toolName: entry.toolName,
          resolved: true,
          durationMs: entry.durationMs,
          count: total,
        });
      }
      // Skip all other occurrences (not the last one)
      continue;
    }

    entries.push({ ...entry, count: 1 });
  }

  return { entries, todos: lastTodos };
}

// ── Bullet + color helpers ───────────────────────────────────────────

function bulletColor(entry: DisplayEntry): string {
  if (entry.kind === 'tool') {
    if (entry.error) return 'bg-destructive';
    if (entry.resolved) return 'bg-accent-success';
    return 'bg-muted-foreground animate-pulse';
  }
  // thinking
  return 'bg-muted-foreground';
}

function textColor(entry: DisplayEntry): string {
  if (entry.kind === 'tool') {
    if (entry.error) return 'text-destructive';
    if (entry.resolved) return 'text-accent-success';
    return 'text-muted-foreground';
  }
  // thinking
  return 'text-foreground/80';
}

// ── Component ────────────────────────────────────────────────────────

interface ActivityBarProps {
  activityLog: ActivityEntry[];
  isStreaming: boolean;
  showTodos?: boolean;
}

export function ActivityBar({ activityLog, isStreaming, showTodos = true }: ActivityBarProps) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activityLog.length, isStreaming]);

  const { entries, todos } = useMemo(() => buildDisplayEntries(activityLog), [activityLog]);

  if (entries.length === 0 && todos.length === 0) return null;

  const maxH = expanded ? 'max-h-72' : 'max-h-36';
  const hasOverflow = activityLog.length > 5;

  return (
    <div
      className="mb-2.5 rounded-lg border border-border/30 bg-card/40 overflow-hidden cursor-pointer select-none"
      onClick={() => setExpanded(!expanded)}
    >
      {(entries.length > 0 || todos.length > 0) && (
        <div
          ref={scrollRef}
          className={`${maxH} overflow-y-auto px-3.5 py-2.5 transition-[max-height] duration-200`}
        >
          {/* Timeline entries */}
          {entries.length > 0 && (
            <div className="relative ml-2 pl-5">
              {/* Vertical line at 7px from container edge; bullets are 8px wide centered at 7px */}
              <div className="absolute left-[6.5px] top-0 bottom-0 w-px bg-border" />

              {entries.map((entry, i) => (
                <div key={i} className="relative flex items-start gap-2.5 py-[3px]">
                  {/* Bullet — centered on the line */}
                  <div
                    className={`absolute left-[-17px] top-[9px] h-2 w-2 rounded-full ${bulletColor(entry)}`}
                  />
                  {/* Content */}
                  <div className={`text-xs leading-relaxed ${textColor(entry)}`}>
                    {entry.kind === 'thinking' ? (
                      <span>{renderThinkingText(entry.text)}</span>
                    ) : (
                      <span>
                        {entry.text}
                        {entry.count > 1 && (
                          <span className="ml-1 text-[11px] opacity-70">x{entry.count}</span>
                        )}
                        {entry.resolved && !entry.error && entry.durationMs != null && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">
                            {formatDuration(entry.durationMs)}
                          </span>
                        )}
                        {entry.error && (
                          <span className="ml-1.5 text-[11px]"> — {entry.error}</span>
                        )}
                        {!entry.resolved && (
                          <span className="ml-0.5">...</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Todo / Plan section — only shown on the latest message to avoid duplication */}
          {showTodos && todos.length > 0 && (
            <div className={`pl-6 ${entries.length > 0 ? 'mt-2.5 border-t border-border/20 pt-2.5' : ''}`}>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Plan
              </span>
              <div className="mt-1.5 space-y-0.5">
                {todos.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 py-[2px]">
                    {/* Checkbox */}
                    <div
                      className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                        t.status === 'completed'
                          ? 'border-accent-success bg-accent-success/15'
                          : t.status === 'in_progress'
                            ? 'border-accent-vibrant bg-accent-vibrant/10'
                            : 'border-muted-foreground/60'
                      }`}
                    >
                      {t.status === 'completed' && (
                        <svg className="h-3 w-3 text-accent-success" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6.5L5 9L9.5 3.5" />
                        </svg>
                      )}
                    </div>
                    <span
                      className={`text-[13px] leading-relaxed ${
                        t.status === 'in_progress'
                          ? 'text-foreground font-medium'
                          : t.status === 'completed'
                            ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                            : 'text-foreground/70'
                      }`}
                    >
                      {t.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasOverflow && (
        <div className="flex items-center justify-center border-t border-border/15 py-0.5 text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      )}
    </div>
  );
}
