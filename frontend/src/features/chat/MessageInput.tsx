import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square, X, Paperclip } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { cn } from '../../lib/utils.ts';
import { apiUploadFile } from '../../api/client.ts';

interface MessageInputProps {
  onSend: (text: string) => void;
  onCancel?: () => void;
  centered?: boolean;
  compact?: boolean;
}

const CYCLING_PLACEHOLDERS = [
  'What is TikTok saying about Ozempic right now?',
  'Compare brand sentiment: Nike vs Adidas on Instagram',
  'Find trending topics in the beauty community this week',
  'Who are the top creators talking about AI on YouTube?',
  'How do people feel about electric vehicles on Reddit?',
];

export function MessageInput({ onSend, onCancel, centered = false, compact = false }: MessageInputProps) {
  const [text, setText] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [attachedTemplate, setAttachedTemplate] = useState<{ filename: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const pendingComposerText = useChatStore((s) => s.pendingComposerText);

  // Hydrate from a pending composer seed (e.g. "+ New → Dashboard" flow).
  useEffect(() => {
    if (!pendingComposerText) return;
    setText(pendingComposerText);
    useChatStore.getState().setPendingComposerText(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, [pendingComposerText]);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be reselected
    e.target.value = '';
    setIsUploading(true);
    try {
      await apiUploadFile<{ gcs_path: string; filename: string }>('/upload/ppt-template', file);
      setAttachedTemplate({ filename: file.name });
    } catch (err) {
      console.error('Template upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={cn(
      centered
        ? 'w-full max-w-2xl px-4'
        : compact
          ? 'mx-auto w-full max-w-lg px-3 pb-3 pt-2'
          : 'mx-auto w-full max-w-2xl px-6 pb-5 pt-2',
    )}>
      {/* Hidden file input for .pptx template uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={handleFileSelect}
      />
      {/* Status indicator */}
      {!centered && isAgentResponding && (
        <div className={cn('flex min-h-[24px] items-center justify-center gap-1.5 mb-2 px-1')}>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-vibrant" />
            <span className="text-xs text-muted-foreground">Agent is responding...</span>
          </div>
        </div>
      )}

      {/* Template pill — shown when a .pptx has been uploaded */}
      {attachedTemplate && (
        <div className="mb-2 flex items-center gap-1 px-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-500">
            <Paperclip className="h-2.5 w-2.5" />
            <span className="max-w-[160px] truncate">{attachedTemplate.filename}</span>
            <button
              onClick={() => setAttachedTemplate(null)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-orange-500/20"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
          <span className="text-[10px] text-muted-foreground/60">Saved as template</span>
        </div>
      )}

      {/* Input area */}
      <div className={cn(
        'flex items-end border bg-card shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-md',
        compact
          ? 'gap-2 rounded-xl border-border/60 px-3 py-2'
          : 'gap-3 rounded-2xl border-border px-4 py-3',
      )}>
        <textarea
          data-testid="chat-input"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={centered ? CYCLING_PLACEHOLDERS[placeholderIndex] : 'Ask me anything on TikTok, Instagram, X, YouTube...'}
          disabled={isAgentResponding}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50',
            compact ? 'max-h-24 text-xs' : 'max-h-36 text-sm',
          )}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isAgentResponding || isUploading}
          title="Upload PowerPoint template"
          className={cn(
            'shrink-0 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none',
            compact ? 'h-6 w-6' : 'h-8 w-8',
          )}
        >
          <Paperclip className={cn(compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5', isUploading && 'animate-pulse')} />
        </button>
        {isAgentResponding ? (
          <button
            onClick={onCancel}
            title="Stop response"
            className={cn(
              'shrink-0 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center transition-colors',
              compact ? 'h-6 w-6' : 'h-8 w-8',
            )}
          >
            <Square className={cn('fill-current', compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className={cn(
              'shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-colors',
              compact ? 'h-6 w-6' : 'h-8 w-8',
            )}
          >
            <Send className={cn(compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} />
          </button>
        )}
      </div>
    </div>
  );
}
