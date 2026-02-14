import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { Button } from '../../components/ui/button.tsx';

interface MessageInputProps {
  onSend: (text: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);

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

  return (
    <div className="border-t border-border bg-card/80 p-4 backdrop-blur-sm">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your sources..."
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
      {isAgentResponding && (
        <div className="mt-2 flex items-center gap-2 px-1">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Agent is responding...</span>
        </div>
      )}
    </div>
  );
}
