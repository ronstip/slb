import { useEffect, useMemo, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../../stores/chat-store.ts';
import { cn } from '../../lib/utils.ts';
import { UserMessage } from './UserMessage.tsx';
import { AgentMessage } from './AgentMessage.tsx';
import { SystemMessage } from './SystemMessage.tsx';

interface MessageListProps {
  onSendMessage?: (text: string) => void;
  compact?: boolean;
  searchQuery?: string;
}

function messageMatches(msg: ChatMessage, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (msg.content.toLowerCase().includes(needle)) return true;
  if (msg.blocks?.some((b) => b.type === 'text' && b.content.toLowerCase().includes(needle))) {
    return true;
  }
  return false;
}

export function MessageList({ onSendMessage, compact = false, searchQuery }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
  const trimmedQuery = (searchQuery ?? '').trim();
  const visibleMessages = useMemo(
    () => (trimmedQuery ? messages.filter((m) => messageMatches(m, trimmedQuery)) : messages),
    [messages, trimmedQuery],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll when content changes (via MutationObserver instead of messages ref)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (stickToBottom.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const showingFiltered = trimmedQuery.length > 0;
  const noMatches = showingFiltered && visibleMessages.length === 0;

  return (
    <div ref={scrollRef} className={cn('flex-1 overflow-y-auto', compact ? 'px-5 py-4' : 'px-6 py-4')}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {showingFiltered && !noMatches && (
          <div className="text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
            {visibleMessages.length} of {messages.length}{' '}
            {messages.length === 1 ? 'message' : 'messages'} match "{trimmedQuery}"
          </div>
        )}
        {noMatches && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No messages match "{trimmedQuery}".
          </div>
        )}
        {visibleMessages.map((msg) => {
          const originalIndex = messages.indexOf(msg);
          const isLatest = originalIndex === messages.length - 1;
          switch (msg.role) {
            case 'user':
              return <UserMessage key={msg.id} message={msg} />;
            case 'agent':
              return <AgentMessage key={msg.id} message={msg} onSuggestionClick={onSendMessage} isLatestMessage={isLatest} />;
            case 'system':
              return <SystemMessage key={msg.id} message={msg} onSendMessage={onSendMessage} />;
          }
        })}
      </div>
    </div>
  );
}
