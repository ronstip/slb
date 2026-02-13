import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';

interface MessageInputProps {
  onSend: (text: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`; // max 6 lines
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
    <div className="border-t border-border-default/40 bg-bg-surface/80 p-4 backdrop-blur-sm">
      <div className="flex items-end gap-2 rounded-2xl border border-border-default/50 bg-bg-surface px-4 py-2.5 shadow-sm focus-within:border-accent/50 focus-within:shadow-md transition-shadow">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your sources..."
          disabled={isAgentResponding}
          rows={1}
          className="max-h-36 flex-1 resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isAgentResponding}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-accent-subtle hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {isAgentResponding && (
        <div className="mt-2 flex items-center gap-2 px-1">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span className="text-xs text-text-secondary">Agent is responding...</span>
        </div>
      )}
    </div>
  );
}
