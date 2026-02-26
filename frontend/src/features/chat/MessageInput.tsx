import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';

interface MessageInputProps {
  onSend: (text: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const sources = useSourcesStore((s) => s.sources);
  const sourcesPanelCollapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggleSourcesPanel = useUIStore((s) => s.toggleSourcesPanel);

  const activeSources = sources.filter((s) => s.active && s.selected);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

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

  const handlePillClick = () => {
    if (sourcesPanelCollapsed) {
      toggleSourcesPanel();
    }
  };

  return (
    <div className="px-6 pb-5 pt-2">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-md transition-shadow focus-within:border-primary/50 focus-within:shadow-lg">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me about anything on TikTok, Instagram, X,  YouTube..."
          disabled={isAgentResponding}
          rows={1}
          className="max-h-36 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleSend}
          disabled={!text.trim() || isAgentResponding}
          className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Context indicator */}
      <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-1.5 px-1">
        {isAgentResponding && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Agent is responding...</span>
          </div>
        )}

        {!isAgentResponding && activeSources.length === 0 && (
          <span className="text-[11px] text-muted-foreground/50">
            No collections in context — check one in the Sources panel
          </span>
        )}

        {!isAgentResponding && activeSources.length > 0 && (
          <>
            <span className="text-[11px] text-muted-foreground/60">Context:</span>
            {activeSources.map((src) => {
              const keywords = src.config.keywords ?? [];
              const platforms = src.config.platforms ?? [];
              const keywordText =
                keywords.length === 0
                  ? 'No keywords'
                  : keywords.length <= 2
                    ? keywords.join(', ')
                    : `${keywords.slice(0, 2).join(', ')} +${keywords.length - 2}`;
              const platformText = platforms
                .map((p) => PLATFORM_LABELS[p] || p)
                .join(', ');

              return (
                <button
                  key={src.collectionId}
                  onClick={handlePillClick}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                    'bg-primary/10 text-primary hover:bg-primary/20',
                  )}
                  title={`Keywords: ${keywords.join(', ')} · Platforms: ${platformText}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>{keywordText}</span>
                  {platformText && (
                    <span className="text-primary/60">· {platformText}</span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
