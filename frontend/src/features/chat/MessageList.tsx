import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat-store.ts';
import { cn } from '../../lib/utils.ts';
import { UserMessage } from './UserMessage.tsx';
import { AgentMessage } from './AgentMessage.tsx';
import { SystemMessage } from './SystemMessage.tsx';

interface MessageListProps {
  onSendMessage?: (text: string) => void;
  compact?: boolean;
}

export function MessageList({ onSendMessage, compact = false }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
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

  return (
    <div ref={scrollRef} className={cn('flex-1 overflow-y-auto', compact ? 'px-5 py-4' : 'px-6 py-4')}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {messages.map((msg, index) => {
          const isLatest = index === messages.length - 1;
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
