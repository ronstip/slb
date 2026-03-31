import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { ActivityEntry, TodoItem } from '../../stores/chat-store.ts';

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Parse inline `code`, ```block```, and **bold** from thinking text into React nodes. */
function renderThinkingText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[2] !== undefined) {
      nodes.push(
        <pre key={++key} className="my-1 rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px] leading-relaxed overflow-x-auto">
          <code>{match[2].trim()}</code>
        </pre>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <code key={++key} className="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
          {match[3]}
        </code>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <strong key={++key} className="font-semibold">{match[4]}</strong>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

// ── Bullet + color helpers ───────────────────────────────────────────

function bulletColor(entry: ActivityEntry): string {
  switch (entry.kind) {
    case 'tool_start':
      return 'bg-muted-foreground animate-pulse';
    case 'tool_complete':
      return 'bg-accent-success';
    case 'tool_error':
      return 'bg-destructive';
    case 'tool_blocked':
      return 'bg-amber-500';
    case 'thinking':
      return 'bg-accent-vibrant/60';
    case 'todo_change':
      if (entry.toStatus === 'completed') return 'bg-accent-success';
      if (entry.toStatus === 'in_progress') return 'bg-accent-vibrant';
      return 'bg-muted-foreground';
  }
}

function textColor(entry: ActivityEntry): string {
  switch (entry.kind) {
    case 'tool_start':
      return 'text-muted-foreground';
    case 'tool_complete':
      return 'text-accent-success';
    case 'tool_error':
      return 'text-destructive';
    case 'tool_blocked':
      return 'text-amber-500';
    case 'thinking':
      return 'text-foreground/90';
    case 'todo_change':
      if (entry.toStatus === 'completed') return 'text-accent-success';
      if (entry.toStatus === 'in_progress') return 'text-accent-vibrant';
      return 'text-foreground/70';
  }
}

// ── Entry renderer ───────────────────────────────────────────────────

function renderEntry(entry: ActivityEntry): ReactNode {
  switch (entry.kind) {
    case 'tool_start':
      return (
        <span>
          {entry.text}
          <span className="ml-0.5">...</span>
        </span>
      );
    case 'tool_complete':
      return (
        <span>
          {entry.text}
          <span className="ml-1.5 text-[11px] text-muted-foreground">
            {formatDuration(entry.durationMs)}
          </span>
        </span>
      );
    case 'tool_error':
      return (
        <span>
          {entry.text}
          <span className="ml-1.5 text-[11px]"> — {entry.error}</span>
        </span>
      );
    case 'tool_blocked':
      return (
        <span className="opacity-60">
          {entry.text} — blocked
        </span>
      );
    case 'thinking':
      return <span>{renderThinkingText(entry.text)}</span>;
    case 'todo_change': {
      const label =
        entry.fromStatus === null
          ? 'Added'
          : entry.toStatus === 'in_progress'
            ? 'Started'
            : entry.toStatus === 'completed'
              ? 'Completed'
              : 'Updated';
      return (
        <span>
          <span className="font-medium">{label}:</span> {entry.content}
        </span>
      );
    }
  }
}

// ── Todo list component ─────────────────────────────────────────────

function TodoList({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Plan
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          {completed}/{todos.length}
        </span>
      </div>
      <div className="space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2">
            {todo.status === 'completed' ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-success" />
            ) : todo.status === 'in_progress' ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-vibrant animate-spin" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
            )}
            <span
              className={`text-xs leading-relaxed ${
                todo.status === 'completed'
                  ? 'text-muted-foreground/50 line-through'
                  : todo.status === 'in_progress'
                    ? 'text-foreground font-medium'
                    : 'text-foreground/70'
              }`}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Timeline renderer (shared between new and legacy modes) ─────────

function ActivityTimeline({
  entries,
  isStreaming,
}: {
  entries: ActivityEntry[];
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always scroll to bottom when new entries arrive during streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Also scroll when streaming starts
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isStreaming]);

  if (entries.length === 0) return null;

  const maxH = expanded ? 'max-h-72' : 'max-h-36';
  const hasOverflow = entries.length > 5;

  return (
    <>
      <div
        ref={scrollRef}
        className={`${maxH} overflow-y-auto px-3.5 py-2.5 transition-[max-height] duration-200 cursor-pointer select-none`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="relative ml-2 pl-5">
          <div className="absolute left-[6.5px] top-0 bottom-0 w-px bg-border" />
          {entries.map((entry, i) => {
            const isThinking = entry.kind === 'thinking';
            return (
              <div key={i} className={`relative flex items-start gap-2.5 py-[3px] ${isThinking ? 'ml-1' : ''}`}>
                <div
                  className={`absolute ${isThinking ? 'left-[-18px]' : 'left-[-17px]'} top-[9px] ${isThinking ? 'h-1.5 w-1.5' : 'h-2 w-2'} rounded-full ${bulletColor(entry)}`}
                />
                <div className={`${isThinking ? 'text-[11px] leading-relaxed pl-0.5 opacity-70' : 'text-xs leading-relaxed'} ${textColor(entry)} ${isThinking && !expanded ? 'line-clamp-2' : ''}`}>
                  {renderEntry(entry)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {hasOverflow && (
        <div
          className="flex items-center justify-center py-0.5 text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      )}
    </>
  );
}

// ── ActivityBlock component ─────────────────────────────────────────
// Supports two modes:
// 1. New (chronological blocks): receives `entries` (scoped to one block)
// 2. Legacy (old messages): receives `activityLog` (full flat list)

interface ActivityBlockProps {
  // New block mode
  entries?: ActivityEntry[];
  // Legacy mode
  activityLog?: ActivityEntry[];
  // Shared
  todos?: TodoItem[];
  isStreaming: boolean;
}

export function ActivityBlock({ entries, activityLog, todos = [], isStreaming }: ActivityBlockProps) {
  // Determine which entries to render
  const allEntries = entries ?? activityLog ?? [];
  const hasTodos = todos.length > 0;

  // Filter out todo_change entries from timeline when showing full todo list
  const filteredEntries = hasTodos
    ? allEntries.filter(e => e.kind !== 'todo_change')
    : allEntries;

  const hasActivity = filteredEntries.length > 0;

  if (!hasActivity && !hasTodos) return null;

  return (
    <div className="my-2 border-l border-r border-border/30 overflow-hidden">
      {hasActivity && (
        <ActivityTimeline entries={filteredEntries} isStreaming={isStreaming} />
      )}
      {hasTodos && <TodoList todos={todos} />}
    </div>
  );
}
