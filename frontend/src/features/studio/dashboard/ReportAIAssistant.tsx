import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, RotateCcw, Square } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover.tsx';
import { useReportAIChat } from './hooks/useReportAIChat.ts';

interface ReportAIAssistantProps {
  artifactId: string;
  agentId?: string;
  /** Called after every successful update_dashboard, once the refetched
   *  layout is in the React Query cache. Lets the parent re-sync the live
   *  grid (which holds widgets in local state and would otherwise show
   *  stale data until manual refresh). */
  onLayoutChanged?: () => void;
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
}: ReportAIAssistantProps) {
  const [open, setOpen] = useState(false);
  const { messages, isStreaming, sendMessage, cancel, reset } = useReportAIChat({
    artifactId,
    agentId,
    onLayoutChanged,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          title="Co-author this report with AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[28rem] max-w-[calc(100vw-2rem)] p-0 flex flex-col max-h-[70vh]"
      >
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          sendMessage={sendMessage}
          cancel={cancel}
          reset={reset}
        />
      </PopoverContent>
    </Popover>
  );
}

interface ChatPanelProps {
  messages: ReturnType<typeof useReportAIChat>['messages'];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

function ChatPanel({ messages, isStreaming, sendMessage, cancel, reset }: ChatPanelProps) {
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
    await sendMessage(text);
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
          <EmptyState />
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>

      <div className="p-2 border-t border-border bg-card/40">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI to change this report…"
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center text-center text-muted-foreground py-6 px-2">
      <Sparkles className="h-5 w-5 text-primary mb-2" />
      <p className="text-xs font-medium text-foreground">Co-author this report</p>
      <p className="text-[11px] mt-1 leading-relaxed">
        Try: <span className="italic">"add a sentiment breakdown by platform"</span>,
        <span className="italic"> "remove the word cloud"</span>, or
        <span className="italic"> "make the summary punchier"</span>.
      </p>
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
      <div className="flex justify-end">
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
