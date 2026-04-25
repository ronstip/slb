import { AlertCircle } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import type { ChatMessage } from '../../stores/chat-store.ts';
import type { DesignResearchResult } from '../../api/types.ts';
import { ActivityBlock } from './ActivityBar.tsx';
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

function cleanText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

interface AgentMessageProps {
  message: ChatMessage;
  onSuggestionClick?: (text: string) => void;
  isLatestMessage?: boolean;
}

export function AgentMessage({ message, onSuggestionClick }: AgentMessageProps) {
  const activePromptMessageId = useChatStore((s) => s.activePromptMessageId);
  const agentLabel = message.activeAgent
    ? (message.activeAgent in AGENT_DISPLAY_NAMES ? AGENT_DISPLAY_NAMES[message.activeAgent] : formatAgentName(message.activeAgent))
    : null;

  // Extract error portion from content
  const errorMatch = message.content.match(/\n\n((?:Connection )?[Ee]rror:\s*.+)$/s);
  const errorText = errorMatch ? errorMatch[1] : null;

  // ── Card classification ──
  const ARTIFACT_TYPES = new Set(['data_export', 'dashboard']);
  const artifactCards: typeof message.cards = [];
  const otherCards: typeof message.cards = [];
  message.cards.forEach((card) => {
    if (ARTIFACT_TYPES.has(card.type)) artifactCards.push(card);
    else otherCards.push(card);
  });
  const CARD_ORDER: Record<string, number> = { metrics_section: 0, topics_section: 1, chart: 2 };
  otherCards.sort((a, b) => (CARD_ORDER[a.type] ?? 0.5) - (CARD_ORDER[b.type] ?? 0.5));

  // ── Determine render mode ──
  // New messages have blocks; old/restored messages may not.
  const blocks = message.blocks && message.blocks.length > 0 ? message.blocks : null;

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

        {/* ── CHRONOLOGICAL BLOCKS (new model) ── */}
        {blocks ? (
          <>
            {blocks.map((block, i) => {
              if (block.type === 'text') {
                const cleaned = cleanText(block.content);
                if (!cleaned) return null;
                return (
                  <Markdown key={i} autoDir className="agent-prose max-w-none break-words">
                    {cleaned}
                  </Markdown>
                );
              }
              if (block.type === 'activity') {
                // Find the latest todos snapshot at this point in the stream
                // (todos are stored on the message, shown on the last activity block)
                const isLastActivityBlock = !blocks.slice(i + 1).some(b => b.type === 'activity');
                return (
                  <ActivityBlock
                    key={i}
                    entries={block.entries}
                    todos={isLastActivityBlock ? message.todos : []}
                    isStreaming={message.isStreaming && i === blocks.length - 1}
                  />
                );
              }
              return null;
            })}
          </>
        ) : (
          <>
            {/* ── LEGACY FALLBACK (old messages without blocks) ── */}
            <ActivityBlock
              activityLog={message.activityLog}
              todos={message.todos}
              isStreaming={message.isStreaming}
            />
            {(() => {
              const rawContent = errorText ? message.content.slice(0, -errorMatch![0].length) : message.content;
              const cleaned = cleanText(rawContent);
              if (!cleaned) return null;
              return (
                <Markdown autoDir className="agent-prose max-w-none break-words">
                  {cleaned}
                </Markdown>
              );
            })()}
          </>
        )}

        {/* Error banner */}
        {errorText && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-[12px] leading-relaxed text-destructive">{errorText}</p>
          </div>
        )}

        {/* ── DELIVERABLES ── */}
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
              return null;
          }
        })}

        {/* Artifact cards — 2-column grid */}
        {artifactCards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {artifactCards.map((card, i) => (
              <ArtifactCard
                key={`artifact-${i}`}
                type={card.type as 'chart' | 'data_export' | 'dashboard'}
                data={card.data}
              />
            ))}
          </div>
        )}

        {/* Streaming cursor */}
        {message.isStreaming && !message.content &&
          message.activityLog.some(e => e.kind === 'tool_start') &&
          message.activityLog.filter(e => e.kind === 'tool_start').every(start =>
            message.activityLog.some(e =>
              (e.kind === 'tool_complete' || e.kind === 'tool_error' || e.kind === 'tool_blocked') &&
              e.toolName === start.toolName
            )
          ) && (
          <div className="flex items-center py-1">
            <div className="h-4 w-0.5 animate-[blink_1s_steps(1)_infinite] rounded-full bg-accent-vibrant/60" />
          </div>
        )}
      </div>
    </div>
  );
}
