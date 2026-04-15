import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Plus, Send, Square, X, Paperclip } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { CollectionPicker } from '../sources/CollectionPicker.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { cn } from '../../lib/utils.ts';
import { apiUploadFile } from '../../api/client.ts';

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
  const [attachedTemplate, setAttachedTemplate] = useState<{ filename: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);

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

  const statusDotColor = (status: string) => {
    if (status === 'running') return 'bg-amber-500 animate-pulse';
    if (status === 'success') return 'bg-emerald-500';
    if (status === 'failed') return 'bg-red-500';
    return 'bg-muted-foreground';
  };

  return (
    <div className={cn(centered ? 'w-full max-w-2xl px-4' : 'mx-auto w-full max-w-2xl px-6 pb-5 pt-2')}>
      {/* Hidden file input for .pptx template uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={handleFileSelect}
      />
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
        'flex items-end gap-3 rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-md',
        centered ? 'px-4 py-3' : 'px-4 py-3',
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
            centered ? 'max-h-36 text-sm' : 'max-h-36 text-sm',
          )}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isAgentResponding || isUploading}
          title="Upload PowerPoint template"
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Paperclip className={cn('h-3.5 w-3.5', isUploading && 'animate-pulse')} />
        </button>
        {isAgentResponding ? (
          <button
            onClick={onCancel}
            title="Stop response"
            className="h-8 w-8 shrink-0 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center transition-colors"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
