import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkStripComments } from '../../lib/remark-strip-comments.ts';
import { Sparkles } from 'lucide-react';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ToolIndicator } from './ToolIndicator.tsx';
import { ThinkingBox } from './ThinkingBox.tsx';
import { StatusLine } from './StatusLine.tsx';
import { ResearchDesignCard } from './cards/ResearchDesignCard.tsx';
import { ProgressCard } from './cards/ProgressCard.tsx';
import { DataExportCard } from './cards/DataExportCard.tsx';
import { ChartCard } from './cards/ChartCard.tsx';
import { PostEmbedCard } from './cards/PostEmbedCard.tsx';
import { DecisionCard } from './cards/DecisionCard.tsx';
import { FindingChip } from './cards/FindingChip.tsx';
import { PlanCard } from './cards/PlanCard.tsx';
import { InsightReportCard } from './cards/InsightReportCard.tsx';
import { FollowUpChips } from './FollowUpChips.tsx';
import { AGENT_DISPLAY_NAMES } from '../../lib/constants.ts';

interface AgentMessageProps {
  message: ChatMessage;
  onSuggestionClick?: (text: string) => void;
}

export function AgentMessage({ message, onSuggestionClick }: AgentMessageProps) {
  const agentLabel = message.activeAgent
    ? AGENT_DISPLAY_NAMES[message.activeAgent] || message.activeAgent
    : null;

  const hasActivity = message.content || message.toolIndicators.length > 0 || message.cards.length > 0;
  // Show thinking dots only when streaming, no activity, AND no status line
  const isThinking = message.isStreaming && !hasActivity && !message.statusLine;

  return (
    <div className="flex gap-3 overflow-hidden max-w-[90%]">
      {/* Avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Agent label */}
        {agentLabel && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/50">
              {agentLabel}
            </span>
          </div>
        )}

        {/* Status line — contextual description of what the agent is doing */}
        {message.isStreaming && message.statusLine && (
          <StatusLine text={message.statusLine} />
        )}

        {/* Thinking indicator — before any content or tools appear */}
        {isThinking && (
          <div className="flex items-center gap-2 py-0.5">
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50 [animation-delay:300ms]" />
            </div>
            <span className="text-xs text-muted-foreground/60">Thinking</span>
          </div>
        )}

        {/* Thinking box — collapsible SQL/tool activity log — shown at top before content */}
        {message.thinkingEntries.length > 0 && (
          <ThinkingBox
            entries={message.thinkingEntries}
            isStreaming={message.isStreaming}
            hasMainContent={!!message.content}
          />
        )}

        {/* Tool indicators */}
        {message.toolIndicators.length > 0 && (
          <div className="mb-2 rounded-lg border border-border/40 bg-accent/20 px-3 py-2 space-y-0.5">
            {message.toolIndicators.map((indicator) => (
              <ToolIndicator key={indicator.name} indicator={indicator} />
            ))}
          </div>
        )}

        {/* Markdown content */}
        {message.content && (
          <div className="agent-prose prose prose-sm max-w-none break-words prose-headings:text-foreground prose-headings:tracking-tight prose-h1:text-18px] prose-h1:font-semibold prose-h1:leading-tight prose-h1:mb-3 prose-h2:text-[15px] prose-h2:font-semibold prose-h2:leading-snug prose-h2:mb-2 prose-h2:mt-5 prose-h3:text-[13px] prose-h3:font-medium prose-h3:leading-snug prose-h3:mb-1.5 prose-h3:mt-4 prose-p:text-[12px] prose-p:leading-[1.75] prose-p:text-muted-foreground/90 prose-p:tracking-[0.01em] prose-p:break-words prose-p:mb-3 prose-strong:text-foreground/90 prose-strong:font-semibold prose-a:text-primary prose-a:font-medium prose-a:no-underline prose-a:break-all hover:prose-a:underline prose-ul:text-[12px] prose-ul:leading-[1.75] prose-ul:text-muted-foreground/90 prose-ul:mb-3 prose-ol:text-[12px] prose-ol:leading-[1.75] prose-ol:text-muted-foreground/90 prose-ol:mb-3 prose-li:text-muted-foreground/90 prose-li:my-0.5 prose-li:marker:text-muted-foreground prose-code:text-[10.5px] prose-code:font-normal prose-code:text-primary/80 prose-code:bg-primary/5 prose-code:rounded prose-code:px-1 prose-code:py-px prose-code:break-all prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-secondary prose-pre:rounded-lg prose-pre:border prose-pre:border-border/50 prose-pre:overflow-x-auto prose-pre:text-[10.5px] prose-th:text-[10.5px] prose-th:font-medium prose-th:text-muted-foreground prose-th:tracking-wide prose-td:text-[11px] prose-td:text-foreground/80 prose-table:my-2 prose-hr:border-border/60 prose-hr:my-8 prose-blockquote:border-primary/20 prose-blockquote:text-muted-foreground/70 prose-blockquote:text-[11.5px] prose-blockquote:not-italic">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkStripComments]}>
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
            case 'data_export':
              return <DataExportCard key={i} data={card.data} />;
            case 'chart':
              return <ChartCard key={i} data={card.data} />;
            case 'post_embed':
              return <PostEmbedCard key={i} data={card.data} />;
            case 'decision':
              return <DecisionCard key={i} data={card.data} onSelect={onSuggestionClick} />;
            case 'finding':
              return <FindingChip key={i} data={card.data} />;
            case 'plan':
              return <PlanCard key={i} data={card.data} onSelect={onSuggestionClick} />;
            case 'insight_report':
              return <InsightReportCard key={i} data={card.data} />;
            default:
              return null;
          }
        })}

        {/* Follow-up suggestions */}
        {!message.isStreaming && message.suggestions.length > 0 && onSuggestionClick && (
          <FollowUpChips suggestions={message.suggestions} onSelect={onSuggestionClick} />
        )}

        {/* Streaming cursor — shown between tool completion and text arrival */}
        {message.isStreaming && !message.content && !message.statusLine && message.toolIndicators.length > 0 && message.toolIndicators.every(t => t.resolved) && (
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
