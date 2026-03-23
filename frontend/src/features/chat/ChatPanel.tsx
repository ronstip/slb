import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { TaskSelector } from './TaskSelector.tsx';
import { StructuredPromptPanel } from './StructuredPromptPanel.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const activePromptData = useChatStore((s) => s.activePromptData);
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const { sendMessage, cancelStream } = useSSEChat();
  const hasMessages = messages.length > 0;

  const cancelPrompt = useCallback(() => {
    useChatStore.getState().setActivePromptData(null);
    useChatStore.getState().setActivePrompt(null);
  }, []);

  return (
    <main data-testid="chat-panel" className="flex min-w-[480px] flex-1 flex-col bg-background">
      {/* Top bar — task selector */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <TaskSelector />
      </div>

      {isRestoring ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hasMessages ? (
        <>
          <MessageList onSendMessage={sendMessage} />
          {activePromptData ? (
            <StructuredPromptPanel onSubmit={sendMessage} onCancel={cancelPrompt} />
          ) : (
            <MessageInput onSend={sendMessage} onCancel={cancelStream} />
          )}
        </>
      ) : (
        <WelcomeScreen onSend={sendMessage} />
      )}
    </main>
  );
}
