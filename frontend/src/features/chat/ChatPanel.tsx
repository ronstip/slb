import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { useGuidedFlowStore } from '../../stores/guided-flow-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { CollectionSelector } from './CollectionSelector.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const { sendMessage, cancelStream } = useSSEChat();
  const hasMessages = messages.length > 0;

  // Wire sendMessage to the guided flow store so it can call the agent on submit
  const setOnSend = useGuidedFlowStore((s) => s.setOnSend);
  useEffect(() => {
    setOnSend(sendMessage);
  }, [sendMessage, setOnSend]);

  return (
    <main className="flex min-w-[480px] flex-1 flex-col bg-background">
      {/* Top bar — collection selector (always visible) */}
      <div className="flex shrink-0 items-center px-4 py-2">
        <CollectionSelector />
      </div>

      {isRestoring ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hasMessages ? (
        <>
          <MessageList onSendMessage={sendMessage} />
          <MessageInput onSend={sendMessage} onCancel={cancelStream} />
        </>
      ) : (
        <WelcomeScreen onSend={sendMessage} />
      )}
    </main>
  );
}
