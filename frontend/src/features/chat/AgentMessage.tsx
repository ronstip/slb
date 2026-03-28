import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkStripComments } from '../../lib/remark-strip-comments.ts';
import { AlertCircle } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ActivityBar } from './ActivityBar.tsx';
import { ArtifactCard } from './cards/ArtifactCard.tsx';
import { InlineChart } from './cards/InlineChart.tsx';
import { ResearchDesignCard } from './cards/ResearchDesignCard.tsx';
import { CollectionProgressCard } from './cards/CollectionProgressCard.tsx';
import { TopicsSectionCard } from './cards/TopicsSectionCard.tsx';
import { MetricsSectionCard } from './cards/MetricsSectionCard.tsx';
import { PromptAnsweredSummary } from './StructuredPromptPanel.tsx';
import { useChatStore } from '../../stores/chat-store.ts';
import { AGENT_DISPLAY_NAMES } from '../../lib/constants.ts';

function formatAgentName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface AgentMessageProps {
  message: ChatMessage;
  onSuggestionClick?: (text: string) => void;
  isLatestMessage?: boolean;
}

export function AgentMessage({ message, onSuggestionClick, isLatestMessage }: AgentMessageProps) {
  const activePromptMessageId = useChatStore((s) => s.activePromptMessageId);
  const agentLabel = message.activeAgent
    ? (message.activeAgent in AGENT_DISPLAY_NAMES ? AGENT_DISPLAY_NAMES[message.activeAgent] : formatAgentName(message.activeAgent))
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

  // ── Card classification ──
  const ARTIFACT_TYPES = new Set(['insight_report', 'data_export', 'dashboard']);
  const artifactCards: typeof message.cards = [];
  const otherCards: typeof message.cards = [];
  message.cards.forEach((card) => {
    if (ARTIFACT_TYPES.has(card.type)) artifactCards.push(card);
    else otherCards.push(card);
  });
  // Ensure metrics always renders above topics
  const CARD_ORDER: Record<string, number> = { metrics_section: 0, topics_section: 1, chart: 2 };
  otherCards.sort((a, b) => (CARD_ORDER[a.type] ?? 0.5) - (CARD_ORDER[b.type] ?? 0.5));

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

        {/* ── Zone 1: ACTIVITY BAR ── */}
        <ActivityBar
          activityLog={message.activityLog}
          isStreaming={message.isStreaming}
          showTodos={isLatestMessage !== false}
        />

        {/* ── Zone 2: VOICE ── */}
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

        {/* ── Zone 3: DELIVERABLES ── */}
        {/* Full-width cards */}
        {otherCards.map((card, i) => {
          switch (card.type) {
            case 'research_design':
              return <ResearchDesignCard key={`other-${i}`} data={card.data as unknown as DesignResearchResult} onCollectionStarted={onSuggestionClick} />;
            case 'metrics_section':
              return <MetricsSectionCard key={`other-${i}`} data={card.data} />;
            case 'topics_section':
              return <TopicsSectionCard key={`other-${i}`} data={card.data} />;
            case 'collection_progress':
              return <CollectionProgressCard key={`other-${i}`} collectionId={card.data.collection_id as string} onCompleted={onSuggestionClick} />;
            case 'chart':
              return <InlineChart key={`other-${i}`} data={card.data} />;
            case 'structured_prompt': {
              if (activePromptMessageId === message.id) return null;
              return <PromptAnsweredSummary key={`other-${i}`} data={card.data} />;
            }
            default:
              // Silently skip removed card types (decision, finding, plan, todo, task_protocol)
              return null;
          }
        })}

        {/* Artifact cards — 2-column grid */}
        {artifactCards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {artifactCards.map((card, i) => (
              <ArtifactCard
                key={`artifact-${i}`}
                type={card.type as 'chart' | 'insight_report' | 'data_export' | 'dashboard'}
                data={card.data}
              />
            ))}
          </div>
        )}

        {/* Streaming cursor — shown between tool completion and text arrival */}
        {message.isStreaming && !cleanContent && message.activityLog.some(e => e.kind === 'tool') && message.activityLog.filter(e => e.kind === 'tool').every(e => e.resolved) && (
          <div className="flex items-center py-1">
            <div className="h-4 w-0.5 animate-[blink_1s_steps(1)_infinite] rounded-full bg-accent-vibrant/60" />
          </div>
        )}
      </div>
    </div>
  );
}
