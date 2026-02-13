import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat-store.ts';
import { UserMessage } from './UserMessage.tsx';
import { AgentMessage } from './AgentMessage.tsx';
import { SystemMessage } from './SystemMessage.tsx';

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming text
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
