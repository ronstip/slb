import { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ThinkingBoxProps {
  entries: string[];
  isStreaming: boolean;
  /** Whether main chat content (text) has arrived */
  hasMainContent?: boolean;
}

function summarize(text: string, maxLen = 60): string {
  const first = text.split('\n')[0].replace(/^#+\s*/, '').replace(/[`*_]/g, '');
  return first.length > maxLen ? first.slice(0, maxLen) + '...' : first;
}

export function ThinkingBox({ entries, isStreaming, hasMainContent = false }: ThinkingBoxProps) {
  const [boxOpen, setBoxOpen] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  // Track whether we auto-opened so we can auto-close later
  const autoOpenedRef = useRef(false);

  // Auto-expand only the latest step (collapse previous ones during streaming)
  useEffect(() => {
    if (entries.length > 0) {
      const latest = entries.length - 1;
      setExpandedSteps(new Set([latest]));
    }
  }, [entries.length]);

  // Auto-open: when streaming, entries arrive, and no main content yet
  useEffect(() => {
    if (isStreaming && entries.length > 0 && !hasMainContent && !boxOpen) {
      setBoxOpen(true);
      autoOpenedRef.current = true;
    }
  }, [isStreaming, entries.length, hasMainContent, boxOpen]);

  // Auto-close: when main content arrives (only if we auto-opened)
  useEffect(() => {
    if (hasMainContent && autoOpenedRef.current) {
      setBoxOpen(false);
      autoOpenedRef.current = false;
    }
  }, [hasMainContent]);

  if (entries.length === 0) return null;

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="mb-2 rounded-md border border-dashed border-border/60 bg-muted/30">
      {/* Master header */}
      <button
        onClick={() => {
          setBoxOpen(!boxOpen);
          // Manual toggle overrides auto behavior
          autoOpenedRef.current = false;
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <Brain className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Thinking ({entries.length})
        </span>
        {isStreaming && (
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant/50" />
        )}
        <span className="ml-auto">
          {boxOpen
            ? <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
        </span>
      </button>

      {/* Per-entry accordion */}
      {boxOpen && (
        <div className="border-t border-dashed border-border/40">
          {entries.map((entry, i) => {
            const isOpen = expandedSteps.has(i);
            return (
              <div key={i} className="border-b border-dashed border-border/30 last:border-b-0">
                {/* Step header */}
                <button
                  onClick={() => toggleStep(i)}
                  className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-muted/40"
                >
                  {isOpen
                    ? <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
                    : <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />}
                  <span className="text-[10px] font-medium text-muted-foreground/60">
                    Step {i + 1}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground/50">
                    {summarize(entry)}
                  </span>
                </button>

                {/* Step content */}
                {isOpen && (
                  <div className="px-3 pb-2 pt-0.5 pl-7">
                    <div className="prose prose-sm max-w-none font-mono text-[10.5px] leading-relaxed text-muted-foreground/70 prose-code:text-[10px] prose-code:text-accent-vibrant/60 prose-pre:bg-background prose-pre:border prose-pre:border-border/30 prose-pre:text-[10px] prose-pre:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
