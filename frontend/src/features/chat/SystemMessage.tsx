import type { ChatMessage } from '../../stores/chat-store.ts';
import { CollectionProgressCard } from './cards/CollectionProgressCard.tsx';

interface SystemMessageProps {
  message: ChatMessage;
  onSendMessage?: (text: string) => void;
}

export function SystemMessage({ message, onSendMessage }: SystemMessageProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs text-muted-foreground/70">{message.content}</p>
      {message.cards.map((card, i) => {
        if (card.type === 'collection_progress') {
          return (
            <div key={i} className="w-full max-w-2xl">
              <CollectionProgressCard
                collectionId={card.data.collection_id as string}
                onCompleted={onSendMessage}
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
