import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ToolIndicator } from './ToolIndicator.tsx';
import { ResearchDesignCard } from './cards/ResearchDesignCard.tsx';
import { ProgressCard } from './cards/ProgressCard.tsx';
import { InsightSummaryCard } from './cards/InsightSummaryCard.tsx';

interface AgentMessageProps {
  message: ChatMessage;
}

export function AgentMessage({ message }: AgentMessageProps) {
  return (
    <div className="max-w-[90%] flex gap-3">
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-accent/5">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
      </div>

      <div className="min-w-0 flex-1">
        {/* Tool indicators */}
        {message.toolIndicators.map((indicator) => (
          <ToolIndicator key={indicator.name} indicator={indicator} />
        ))}

        {/* Markdown content */}
        {message.content && (
          <div className="agent-prose prose prose-sm max-w-none prose-headings:text-text-primary prose-headings:tracking-tight prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-p:text-[13.5px] prose-p:leading-[1.7] prose-p:text-text-secondary prose-p:tracking-[0.01em] prose-strong:text-text-primary prose-strong:font-semibold prose-a:text-accent prose-a:font-medium prose-a:no-underline hover:prose-a:underline prose-ul:text-[13.5px] prose-ul:leading-[1.7] prose-ul:text-text-secondary prose-ol:text-[13.5px] prose-ol:leading-[1.7] prose-ol:text-text-secondary prose-li:text-text-secondary prose-li:marker:text-text-tertiary prose-code:text-[12px] prose-code:font-normal prose-code:text-accent prose-code:bg-accent/5 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-bg-surface-secondary prose-pre:rounded-xl prose-pre:border prose-pre:border-border-default/40 prose-th:text-xs prose-th:text-text-secondary prose-td:text-xs prose-td:text-text-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Structured cards */}
        {message.cards.map((card, i) => {
          switch (card.type) {
            case 'research_design':
              return <ResearchDesignCard key={i} data={card.data as unknown as DesignResearchResult} />;
            case 'progress':
              return <ProgressCard key={i} data={card.data} />;
            case 'insight_summary':
              return <InsightSummaryCard key={i} data={card.data} />;
            default:
              return null;
          }
        })}

        {/* Streaming cursor */}
        {message.isStreaming && !message.content && message.toolIndicators.every(t => t.resolved) && (
          <div className="flex items-center gap-1.5 py-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/40" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/40 [animation-delay:150ms]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/40 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
