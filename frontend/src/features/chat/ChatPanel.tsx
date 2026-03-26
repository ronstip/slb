import { useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { TaskSelector } from './TaskSelector.tsx';
import { CollectionSelector } from './CollectionSelector.tsx';
import { StructuredPromptPanel } from './StructuredPromptPanel.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const activePromptData = useChatStore((s) => s.activePromptData);
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const { sendMessage, sendSystemMessage, cancelStream } = useSSEChat();

  // Listen for collection completion events from useCollectionPolling
  // to trigger agent continuation in the originating session only.
  useEffect(() => {
    const handler = (e: Event) => {
      const { postsCollected, sessionId: sourceSessionId } = (e as CustomEvent).detail;
      // Guard: only resume in the session that started the collection.
      // If the user has navigated to a different session, ignore the event
      // to prevent the wrong agent from receiving a context-less continuation.
      const currentSessionId = useChatStore.getState().sessionId;
      if (sourceSessionId && sourceSessionId !== currentSessionId) return;
      sendSystemMessage(
        `[CONTINUE] Collection complete. ${postsCollected} posts collected and enriched. Resume remaining todos.`,
      );
    };
    window.addEventListener('collection-complete', handler);
    return () => window.removeEventListener('collection-complete', handler);
  }, [sendSystemMessage]);
  const hasMessages = messages.length > 0;

  const cancelPrompt = useCallback(() => {
    useChatStore.getState().setActivePromptData(null);
    useChatStore.getState().setActivePrompt(null);
  }, []);

  return (
    <main data-testid="chat-panel" className="flex min-w-[480px] flex-1 flex-col bg-background">
      {/* Top bar — collection + task selectors */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <CollectionSelector />
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
