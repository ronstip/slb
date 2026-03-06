import { useChatStore } from '../../stores/chat-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { CollectionSelector } from './CollectionSelector.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const { sendMessage, cancelStream } = useSSEChat();
  const hasMessages = messages.length > 0;

  return (
    <main className="flex min-w-[480px] flex-1 flex-col bg-background">
      {/* Top bar — collection selector (always visible) */}
      <div className="flex shrink-0 items-center px-4 py-2">
        <CollectionSelector />
      </div>

      {hasMessages ? (
        <>
          <MessageList onSendMessage={sendMessage} />
          <MessageInput onSend={sendMessage} onCancel={cancelStream} />
        </>
      ) : (
        <WelcomeScreen onPromptClick={sendMessage} onSend={sendMessage} />
      )}
    </main>
  );
}
