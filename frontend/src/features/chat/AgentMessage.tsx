import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ToolIndicator } from './ToolIndicator.tsx';
import { ResearchDesignCard } from './cards/ResearchDesignCard.tsx';
import { ProgressCard } from './cards/ProgressCard.tsx';
import { InsightSummaryCard } from './cards/InsightSummaryCard.tsx';
import { DataExportCard } from './cards/DataExportCard.tsx';

interface AgentMessageProps {
  message: ChatMessage;
}

export function AgentMessage({ message }: AgentMessageProps) {
  return (
    <div className="max-w-[90%] flex gap-3 overflow-hidden">
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Tool indicators */}
        {message.toolIndicators.map((indicator) => (
          <ToolIndicator key={indicator.name} indicator={indicator} />
        ))}

        {/* Markdown content */}
        {message.content && (
          <div className="agent-prose prose prose-sm max-w-none break-words prose-headings:text-foreground prose-headings:tracking-tight prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-p:text-[13.5px] prose-p:leading-[1.7] prose-p:text-muted-foreground prose-p:tracking-[0.01em] prose-p:break-words prose-strong:text-foreground prose-strong:font-semibold prose-a:text-primary prose-a:font-medium prose-a:no-underline prose-a:break-all hover:prose-a:underline prose-ul:text-[13.5px] prose-ul:leading-[1.7] prose-ul:text-muted-foreground prose-ol:text-[13.5px] prose-ol:leading-[1.7] prose-ol:text-muted-foreground prose-li:text-muted-foreground prose-li:marker:text-muted-foreground/50 prose-code:text-[12px] prose-code:font-normal prose-code:text-primary prose-code:bg-primary/5 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:break-all prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-secondary prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:overflow-x-auto prose-th:text-xs prose-th:text-muted-foreground prose-td:text-xs prose-td:text-foreground">
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
            case 'data_export':
              return <DataExportCard key={i} data={card.data} />;
            default:
              return null;
          }
        })}

        {/* Streaming cursor */}
        {message.isStreaming && !message.content && message.toolIndicators.every(t => t.resolved) && (
          <div className="flex items-center gap-1.5 py-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/40" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/40 [animation-delay:150ms]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/40 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
