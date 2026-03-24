import type { ChatMessage } from '../../stores/chat-store.ts';

const SYSTEM_EVENT_PATTERNS = [
  /^Collection .+ just (started|finished)/i,
  /^Collection just started/i,
];

function isSystemEvent(content: string): boolean {
  return SYSTEM_EVENT_PATTERNS.some((re) => re.test(content.trim()));
}

interface UserMessageProps {
  message: ChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const content = message.content.replace(/<!--[\s\S]*?-->/g, '').trim();

  if (isSystemEvent(content)) {
    return (
      <div className="flex justify-center">
        <p className="text-[11px] text-muted-foreground/60 italic px-2">{content}</p>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 shadow-sm overflow-hidden">
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {content}
        </p>
      </div>
    </div>
  );
}
