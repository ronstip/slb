import type { ChatMessage } from '../../stores/chat-store.ts';

interface SystemMessageProps {
  message: ChatMessage;
}

export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div className="flex justify-center">
      <p className="text-xs text-muted-foreground/70">{message.content}</p>
    </div>
  );
}
