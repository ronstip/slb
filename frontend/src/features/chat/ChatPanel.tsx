import { useChatStore } from '../../stores/chat-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const { sendMessage } = useSSEChat();
  const hasMessages = messages.length > 0;

  return (
    <main className="flex min-w-[480px] flex-1 flex-col bg-bg-primary">
      {hasMessages ? (
        <MessageList />
      ) : (
        <WelcomeScreen onPromptClick={sendMessage} />
      )}
      <MessageInput onSend={sendMessage} />
    </main>
  );
}
