import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat-store.ts';
import { UserMessage } from './UserMessage.tsx';
import { AgentMessage } from './AgentMessage.tsx';
import { SystemMessage } from './SystemMessage.tsx';

export function MessageList() {
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

  // Auto-scroll only when stuck to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((msg) => {
          switch (msg.role) {
            case 'user':
              return <UserMessage key={msg.id} message={msg} />;
            case 'agent':
              return <AgentMessage key={msg.id} message={msg} />;
            case 'system':
              return <SystemMessage key={msg.id} message={msg} />;
          }
        })}
      </div>
    </div>
  );
}
