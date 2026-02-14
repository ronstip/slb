import type { ChatMessage } from '../../stores/chat-store.ts';

interface UserMessageProps {
  message: ChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 shadow-sm overflow-hidden">
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {message.content}
        </p>
      </div>
    </div>
  );
}
