import type { ChatMessage } from '../../stores/chat-store.ts';

interface UserMessageProps {
  message: ChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/10 px-4 py-2.5 shadow-sm">
        <p className="whitespace-pre-wrap text-sm text-text-primary">
          {message.content}
        </p>
      </div>
    </div>
  );
}
