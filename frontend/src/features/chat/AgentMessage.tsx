import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkStripComments } from '../../lib/remark-strip-comments.ts';
import { AlertCircle } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ToolIndicator } from './ToolIndicator.tsx';
import { ThinkingBox } from './ThinkingBox.tsx';
import { StatusLine } from './StatusLine.tsx';
import { ResearchDesignCard } from './cards/ResearchDesignCard.tsx';
import { DataExportCard } from './cards/DataExportCard.tsx';
import { ChartCard } from './cards/ChartCard.tsx';
import { DecisionCard } from './cards/DecisionCard.tsx';
import { FindingChip } from './cards/FindingChip.tsx';
import { PlanCard } from './cards/PlanCard.tsx';
import { InsightReportCard } from './cards/InsightReportCard.tsx';
import { DashboardCard } from './cards/DashboardCard.tsx';
import { CollectionProgressCard } from './cards/CollectionProgressCard.tsx';
import { PromptAnsweredSummary } from './StructuredPromptPanel.tsx';
import { useChatStore } from '../../stores/chat-store.ts';
import { FollowUpChips } from './FollowUpChips.tsx';
import { AGENT_DISPLAY_NAMES } from '../../lib/constants.ts';

function formatAgentName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface AgentMessageProps {
  message: ChatMessage;
  onSuggestionClick?: (text: string) => void;
}

export function AgentMessage({ message, onSuggestionClick }: AgentMessageProps) {
  const activePromptMessageId = useChatStore((s) => s.activePromptMessageId);
  const agentLabel = message.activeAgent
    ? AGENT_DISPLAY_NAMES[message.activeAgent] || formatAgentName(message.activeAgent)
    : null;

  // Extract error portion from content (appended as "\n\nError: ..." or "\n\nConnection error: ...")
  const errorMatch = message.content.match(/\n\n((?:Connection )?[Ee]rror:\s*.+)$/s);
  const errorText = errorMatch ? errorMatch[1] : null;
  const rawContent = errorText ? message.content.slice(0, -errorMatch![0].length) : message.content;
  // Strip HTML comments (e.g. <!-- status: ... -->) that leak through during streaming.
  // Also strip trailing unclosed comments from in-progress chunks.
  const cleanContent = rawContent
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/g, '')
    .trim();

  const hasActivity = cleanContent || errorText || message.toolIndicators.length > 0 || message.cards.length > 0;
  // Show thinking dots only when streaming, no activity, AND no status line
  const isThinking = message.isStreaming && !hasActivity && !message.statusLine;

  return (
    <div className="flex gap-3 overflow-hidden max-w-3xl">
      {/* Avatar */}
      <div className="mt-0.5 shrink-0">
        <Logo size="sm" showText={false} />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Agent label */}
        {agentLabel && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
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
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant/50" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant/50 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant/50 [animation-delay:300ms]" />
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
          <div className="mb-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 space-y-0.5">
            {message.toolIndicators.map((indicator, idx) => {
              const sameNameAll = message.toolIndicators.filter((t) => t.name === indicator.name);
              const sameNameIdx = message.toolIndicators.slice(0, idx).filter((t) => t.name === indicator.name).length;
              const suffix = sameNameAll.length > 1 ? ` (${sameNameIdx + 1}/${sameNameAll.length})` : '';
              return (
                <ToolIndicator
                  key={`${indicator.name}-${idx}`}
                  indicator={{ ...indicator, displayText: indicator.displayText + suffix }}
                />
              );
            })}
          </div>
        )}

        {/* Markdown content */}
        {cleanContent && (
          <div dir="auto" className="agent-prose max-w-none break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkStripComments]}>
              {cleanContent}
            </ReactMarkdown>
          </div>
        )}

        {/* Error banner */}
        {errorText && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-[12px] leading-relaxed text-destructive">{errorText}</p>
          </div>
        )}

        {/* Structured cards */}
        {message.cards.map((card, i) => {
          switch (card.type) {
            case 'research_design':
              return <ResearchDesignCard key={i} data={card.data as unknown as DesignResearchResult} onCollectionStarted={onSuggestionClick} />;
            case 'data_export':
              return <DataExportCard key={i} data={card.data} />;
            case 'chart':
              return <ChartCard key={i} data={card.data} />;
            case 'decision':
              return <DecisionCard key={i} data={card.data} onSelect={onSuggestionClick} />;
            case 'finding':
              return <FindingChip key={i} data={card.data} />;
            case 'plan':
              return <PlanCard key={i} data={card.data} onSelect={onSuggestionClick} />;
            case 'insight_report':
              return <InsightReportCard key={i} data={card.data} />;
            case 'dashboard':
              return <DashboardCard key={i} data={card.data} />;
            case 'collection_progress':
              return <CollectionProgressCard key={i} collectionId={card.data.collection_id as string} onCompleted={onSuggestionClick} />;
            case 'structured_prompt': {
              if (activePromptMessageId === message.id) return null;
              return <PromptAnsweredSummary key={i} data={card.data} />;
            }
            default:
              return null;
          }
        })}

        {/* Follow-up suggestions */}
        {!message.isStreaming && message.suggestions.length > 0 && onSuggestionClick && (
          <FollowUpChips suggestions={message.suggestions} onSelect={onSuggestionClick} />
        )}

        {/* Streaming cursor — shown between tool completion and text arrival */}
        {message.isStreaming && !cleanContent && !message.statusLine && message.toolIndicators.length > 0 && message.toolIndicators.every(t => t.resolved) && (
          <div className="flex items-center py-1">
            <div className="h-4 w-0.5 animate-[blink_1s_steps(1)_infinite] rounded-full bg-accent-vibrant/60" />
          </div>
        )}
      </div>
    </div>
  );
}
