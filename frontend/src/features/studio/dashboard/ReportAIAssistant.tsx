import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Send, Loader2, RotateCcw, Square, X, BookOpenText, Check } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover.tsx';
import { getAgentTopics } from '../../../api/endpoints/topics.ts';
import { useReportAIChat } from './hooks/useReportAIChat.ts';
import { buildStoryMessage, type StoryTopic } from './story-mode.ts';
import type { AttachedWidget } from './coauthor-context.ts';

interface ReportAIAssistantProps {
  artifactId: string;
  agentId?: string;
  /** Called after every successful update_dashboard, once the refetched
   *  layout is in the React Query cache. Lets the parent re-sync the live
   *  grid (which holds widgets in local state and would otherwise show
   *  stale data until manual refresh). */
  onLayoutChanged?: () => void;
  /** Controlled open state. Lifted to the parent so the grid can show the
   *  per-widget "attach" affordance only while the co-author is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Widgets the user pinned on the grid for the next message. */
  attachedWidgets: AttachedWidget[];
  /** Remove one pinned widget (chip ✕). */
  onRemoveAttached: (i: string) => void;
  /** Clear all pins (after a send, or via "clear"). */
  onClearAttached: () => void;
}

/**
 * The "AI" button in the report top bar + its floating popover.
 *
 * The popover hosts a small chat that talks to the `report_editor` backend
 * agent (see api/agent/prompts/report_editor_prompt.py). The agent has
 * `read_dashboard` and `update_dashboard` scoped to this report's
 * `artifactId`, so it can add, modify, or remove widgets on user request.
 * Successful edits trigger a toast with an Undo action (see useReportAIChat).
 */
export function ReportAIAssistant({
  artifactId,
  agentId,
  onLayoutChanged,
  open,
  onOpenChange,
  attachedWidgets,
  onRemoveAttached,
  onClearAttached,
}: ReportAIAssistantProps) {
  const { messages, isStreaming, sendMessage, cancel, reset } = useReportAIChat({
    artifactId,
    agentId,
    onLayoutChanged,
  });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1.5 text-xs border-0 text-white shadow-sm bg-gradient-to-r from-primary from-60% to-accent-blue hover:from-primary/90 hover:to-accent-blue/90"
          title="Co-author this report with AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Co-author AI
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[28rem] max-w-[calc(100vw-2rem)] p-0 flex flex-col max-h-[70vh]"
        // Clicking a widget's "attach" affordance on the grid is an
        // interaction outside the popover - without this it would close the
        // co-author mid-selection. Keep it open for those clicks only.
        onInteractOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest('[data-coauthor-attach]')) e.preventDefault();
        }}
      >
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          sendMessage={sendMessage}
          cancel={cancel}
          reset={reset}
          attachedWidgets={attachedWidgets}
          onRemoveAttached={onRemoveAttached}
          onClearAttached={onClearAttached}
          agentId={agentId}
        />
      </PopoverContent>
    </Popover>
  );
}

interface ChatPanelProps {
  messages: ReturnType<typeof useReportAIChat>['messages'];
  isStreaming: boolean;
  sendMessage: (
    text: string,
    attached?: AttachedWidget[],
    displayText?: string,
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  attachedWidgets: AttachedWidget[];
  onRemoveAttached: (i: string) => void;
  onClearAttached: () => void;
  /** Enables the "Tell a story" topic suggestions in the empty state. */
  agentId?: string;
}

function ChatPanel({
  messages,
  isStreaming,
  sendMessage,
  cancel,
  reset,
  attachedWidgets,
  onRemoveAttached,
  onClearAttached,
  agentId,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to the latest message as it streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus the textarea on open / after each send.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft('');
    const pinned = attachedWidgets;
    onClearAttached();
    await sendMessage(text, pinned);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Co-Author
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={reset}
          disabled={messages.length === 0 && !isStreaming}
          title="Start over"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 text-sm"
      >
        {messages.length === 0 && (
          <EmptyState
            agentId={agentId}
            isStreaming={isStreaming}
            onGenerateStory={(request) => {
              const { outgoing, display } = buildStoryMessage(request);
              void sendMessage(outgoing, [], display);
            }}
          />
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>

      <div className="p-2 border-t border-border bg-card/40">
        {attachedWidgets.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {attachedWidgets.map((w) => (
              <span
                key={w.i}
                className="inline-flex max-w-[12rem] items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground"
                title={w.title || 'Untitled widget'}
              >
                <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" />
                <span className="truncate">{w.title || 'Untitled widget'}</span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onRemoveAttached(w.i)}
                  title="Remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="ml-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onClearAttached}
            >
              Clear
            </button>
          </div>
        ) : (
          <p className="mb-1.5 text-[11px] text-muted-foreground px-0.5">
            Tip: click a widget on the report to focus the AI on it.
          </p>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedWidgets.length > 0
                ? 'Ask the AI to change the selected widget(s)…'
                : 'Ask the AI to change this report…'
            }
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              variant="ghost"
              size="icon"
              className="absolute bottom-1.5 right-1.5 h-6 w-6"
              onClick={cancel}
              title="Stop"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="absolute bottom-1.5 right-1.5 h-6 w-6"
              onClick={() => void handleSubmit()}
              disabled={!draft.trim()}
              title="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground px-0.5">
          Edits apply instantly. Use the toast Undo to revert the last change.
        </p>
      </div>
    </div>
  );
}

/** How many topic suggestion chips to show in the story section. */
const MAX_STORY_TOPIC_CHIPS = 6;

function EmptyState({
  agentId,
  isStreaming,
  onGenerateStory,
}: {
  agentId?: string;
  isStreaming: boolean;
  /** Topic chips (selection order = section order) and/or a freeform brief.
   *  Both empty = let the AI pick the angle. Each topic carries its cluster id
   *  so the agent can scope charts with filters.topics directly. */
  onGenerateStory: (request: { topics: StoryTopic[]; brief: string }) => void;
}) {
  // Selection order matters - it becomes the story's section order. We track the
  // cluster id alongside the name so the agent gets the topic_id to filter on.
  const [selected, setSelected] = useState<StoryTopic[]>([]);
  // Freeform brief - the user describes the angle in their own words. Works
  // with or without topic chips selected.
  const [brief, setBrief] = useState('');

  // Same query key as the agent Topics tab, so an already-visited tab is a
  // cache hit and the chips render instantly.
  const { data: topics, isLoading } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId!),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  const chips = (topics ?? [])
    .slice()
    .sort((a, b) => (b.post_count ?? 0) - (a.post_count ?? 0))
    .slice(0, MAX_STORY_TOPIC_CHIPS);

  const toggle = (topic: StoryTopic) =>
    setSelected((prev) =>
      prev.some((t) => t.id === topic.id)
        ? prev.filter((t) => t.id !== topic.id)
        : [...prev, topic],
    );

  return (
    <div className="flex flex-col text-muted-foreground py-4 px-2 gap-4">
      <div className="flex flex-col items-center text-center">
        <Sparkles className="h-5 w-5 text-primary mb-2" />
        <p className="text-xs font-medium text-foreground">Co-author this report</p>
        <p className="text-[11px] mt-1 leading-relaxed">
          Try: <span className="italic">"add a sentiment breakdown by platform"</span>,
          <span className="italic"> "remove the word cloud"</span>, or
          <span className="italic"> "make the summary punchier"</span>.
        </p>
      </div>

      <div className="border-t border-border pt-3 flex flex-col items-center text-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <BookOpenText className="h-3.5 w-3.5 text-primary" />
          Tell a story
        </div>
        <p className="text-[11px] leading-relaxed">
          Turn this report into a scrolling narrative. Pick the angles - or let the
          AI find the strongest story in the data.
        </p>
        {isLoading && (
          <div className="flex flex-wrap justify-center gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <span
                key={i}
                className="h-6 w-24 animate-pulse rounded-full bg-muted"
              />
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {chips.map((t) => {
              const active = selected.some((s) => s.id === t.cluster_id);
              return (
                <button
                  key={t.cluster_id}
                  type="button"
                  onClick={() => toggle({ id: t.cluster_id, name: t.topic_name })}
                  aria-pressed={active}
                  title={t.topic_summary}
                  className={`inline-flex max-w-[12rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{t.topic_name}</span>
                </button>
              );
            })}
          </div>
        )}
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          placeholder="…or describe the story you want (e.g. how sentiment shifted after the launch)"
          className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none"
        />
        <Button
          size="sm"
          className="h-7 mt-1 gap-1.5 text-xs"
          disabled={isStreaming}
          onClick={() => onGenerateStory({ topics: selected, brief })}
        >
          <BookOpenText className="h-3.5 w-3.5" />
          {selected.length > 0 || brief.trim() ? 'Generate story' : 'Find the story'}
        </Button>
      </div>
    </div>
  );
}

function MessageRow({
  message,
}: {
  message: ReturnType<typeof useReportAIChat>['messages'][number];
}) {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
            {message.attachments.map((title, i) => (
              <span
                key={i}
                className="inline-flex max-w-[10rem] items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
              >
                <Sparkles className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{title || 'Untitled widget'}</span>
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm whitespace-pre-wrap break-words">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-w-[95%]">
      {message.toolNotes && message.toolNotes.length > 0 && (
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          {message.toolNotes.map((note, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {message.isStreaming && i === (message.toolNotes?.length ?? 0) - 1 ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
              )}
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}
      {(message.text || message.isStreaming) && (
        <div className="rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground whitespace-pre-wrap break-words">
          {message.text}
          {message.isStreaming && !message.text && (
            <Loader2 className="h-3 w-3 animate-spin inline-block text-muted-foreground" />
          )}
        </div>
      )}
      {message.error && (
        <div className="rounded-lg bg-destructive/10 text-destructive px-3 py-1.5 text-xs">
          {message.error}
        </div>
      )}
    </div>
  );
}
