import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Plus, Send, Square, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useGuidedFlowStore } from '../../stores/guided-flow-store.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { CollectionPicker } from '../sources/CollectionPicker.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { cn } from '../../lib/utils.ts';

interface MessageInputProps {
  onSend: (text: string) => void;
  onCancel?: () => void;
  centered?: boolean;
}

const CYCLING_PLACEHOLDERS = [
  'What is TikTok saying about Ozempic right now?',
  'Compare brand sentiment: Nike vs Adidas on Instagram',
  'Find trending topics in the beauty community this week',
  'Who are the top creators talking about AI on YouTube?',
  'How do people feel about electric vehicles on Reddit?',
];

export function MessageInput({ onSend, onCancel, centered = false }: MessageInputProps) {
  const [text, setText] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const isGuidedFlowActive = useGuidedFlowStore((s) => s.activeFlow !== null);

  const sources = useSourcesStore((s) => s.sources);
  const removeFromSession = useSourcesStore((s) => s.removeFromSession);
  const activeSources = sources.filter((s) => s.active && s.selected);

  // Cycle placeholder text in centered/welcome mode
  useEffect(() => {
    if (!centered || text) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % CYCLING_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [centered, text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  // Hide input during guided flow (user interacts via step cards instead)
  if (isGuidedFlowActive && !centered) {
    return (
      <div className="px-6 pb-5 pt-2">
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/50 bg-card/50 py-3.5">
          <span className="text-xs text-muted-foreground/60">Complete the steps above to continue...</span>
        </div>
      </div>
    );
  }

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isAgentResponding) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusDotColor = (status: string) => {
    if (status === 'collecting' || status === 'enriching' || status === 'pending') return 'bg-amber-500 animate-pulse';
    if (status === 'monitoring') return 'bg-emerald-500 animate-pulse';
    if (status === 'completed') return 'bg-emerald-500';
    if (status === 'failed') return 'bg-red-500';
    return 'bg-muted-foreground';
  };

  return (
    <div className={cn(centered ? 'w-full max-w-2xl px-4' : 'px-6 pb-5 pt-2')}>
      {/* Context bar — active source pills above the input */}
      <div className={cn(
        'flex min-h-[24px] flex-wrap items-center justify-center gap-1.5',
        centered ? 'mb-3' : 'mb-2 px-1',
      )}>
        {!centered && isAgentResponding && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant" />
            <span className="text-xs text-muted-foreground">Agent is responding...</span>
          </div>
        )}

        {!(isAgentResponding && !centered) && activeSources.length > 0 && (
          <>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Context</span>
            {activeSources.map((src) => {
              const keywords = src.config.keywords ?? [];
              const keywordText =
                keywords.length === 0
                  ? src.title
                  : keywords.length <= 2
                    ? keywords.join(', ')
                    : `${keywords.slice(0, 2).join(', ')} +${keywords.length - 2}`;

              return (
                <span
                  key={src.collectionId}
                  className="group inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors"
                  title={`${src.title} · ${(src.config.platforms ?? []).map((p) => PLATFORM_LABELS[p] || p).join(', ')}`}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDotColor(src.status))} />
                  <span className="max-w-[120px] truncate">{keywordText}</span>
                  <button
                    onClick={() => removeFromSession(src.collectionId)}
                    className="ml-0.5 hidden rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline-flex"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}

            {/* Add more button */}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent-vibrant/10 hover:text-accent-vibrant">
                  <Plus className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start" side="top">
                <CollectionPicker onClose={() => setPickerOpen(false)} />
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      {/* Input area */}
      <div className={cn(
        'flex items-end gap-2 rounded-2xl border border-border bg-card shadow-md transition-shadow focus-within:border-foreground/20 focus-within:shadow-lg',
        centered ? 'px-5 py-4' : 'px-4 py-2.5',
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={centered ? CYCLING_PLACEHOLDERS[placeholderIndex] : 'Ask me anything on TikTok, Instagram, X, YouTube...'}
          disabled={isAgentResponding}
          rows={centered ? 2 : 1}
          className={cn(
            'flex-1 resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50',
            centered ? 'max-h-48 text-base' : 'max-h-36 text-sm',
          )}
        />
        {isAgentResponding ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Stop response"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSend}
            disabled={!text.trim()}
            className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
