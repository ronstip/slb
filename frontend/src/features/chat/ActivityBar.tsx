import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ActivityEntry } from '../../stores/chat-store.ts';

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
      return 'bg-muted-foreground';
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
      return 'text-foreground/80';
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

// ── Component ────────────────────────────────────────────────────────

interface ActivityBarProps {
  activityLog: ActivityEntry[];
  isStreaming: boolean;
}

export function ActivityBar({ activityLog, isStreaming }: ActivityBarProps) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activityLog.length, isStreaming]);

  if (activityLog.length === 0) return null;

  const maxH = expanded ? 'max-h-72' : 'max-h-36';
  const hasOverflow = activityLog.length > 5;

  return (
    <div
      className="mb-2.5 rounded-lg border border-border/30 bg-card/40 overflow-hidden cursor-pointer select-none"
      onClick={() => setExpanded(!expanded)}
    >
      <div
        ref={scrollRef}
        className={`${maxH} overflow-y-auto px-3.5 py-2.5 transition-[max-height] duration-200`}
      >
        <div className="relative ml-2 pl-5">
          {/* Vertical line */}
          <div className="absolute left-[6.5px] top-0 bottom-0 w-px bg-border" />

          {activityLog.map((entry, i) => (
            <div key={i} className="relative flex items-start gap-2.5 py-[3px]">
              {/* Bullet — centered on the line */}
              <div
                className={`absolute left-[-17px] top-[9px] h-2 w-2 rounded-full ${bulletColor(entry)}`}
              />
              {/* Content */}
              <div className={`text-xs leading-relaxed ${textColor(entry)}`}>
                {renderEntry(entry)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasOverflow && (
        <div className="flex items-center justify-center border-t border-border/15 py-0.5 text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      )}
    </div>
  );
}
