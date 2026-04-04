import { useCallback, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { TaskSelector } from './TaskSelector.tsx';
import { CollectionSelector } from './CollectionSelector.tsx';
import { StructuredPromptPanel } from './StructuredPromptPanel.tsx';
import { TaskProgressPill } from './TaskProgressPill.tsx';

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const activePromptData = useChatStore((s) => s.activePromptData);
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const { sendMessage, sendSystemMessage, cancelStream } = useSSEChat();
  const mountContinuationFiredRef = useRef(false);

  // Listen for collection completion events from useCollectionPolling
  // to trigger agent continuation in the originating session only.
  useEffect(() => {
    const handler = (e: Event) => {
      const { totalPosts, title, sessionId: sourceSessionId } = (e as CustomEvent).detail;
      // Guard: only resume in the session that started the collection.
      const currentSessionId = useChatStore.getState().sessionId;
      if (sourceSessionId && sourceSessionId !== currentSessionId) return;
      // Guard: don't send if agent is already responding
      if (useChatStore.getState().isAgentResponding) return;
      sendSystemMessage(
        `[CONTINUE] All collections for task "${title ?? 'unknown'}" complete. ${totalPosts ?? 0} posts collected and enriched. Resume remaining todos — analyze the data and deliver findings.`,
      );
    };
    window.addEventListener('collection-complete', handler);
    return () => window.removeEventListener('collection-complete', handler);
  }, [sendSystemMessage]);

  // On mount / session change: check if there's a task awaiting analysis
  // that should be continued (handles page refresh, navigation back, etc.)
  useEffect(() => {
    if (mountContinuationFiredRef.current) return;
    const sessionId = useChatStore.getState().sessionId;
    if (!sessionId) return;
    if (useChatStore.getState().isAgentResponding) return;

    // Check sources for tasks where all collections are complete
    const sources = useSourcesStore.getState().sources;
    const tasks = useAgentStore.getState().agents;
    const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'monitoring']);

    for (const task of tasks) {
      if (task.status !== 'awaiting_analysis') continue;
      if (task.session_id !== sessionId) continue;

      // Verify all collections are terminal
      const taskCollections = sources.filter((s) => s.taskId === task.task_id);
      if (taskCollections.length === 0) continue;
      const allTerminal = taskCollections.every((s) => TERMINAL.has(s.status ?? ''));
      if (!allTerminal) continue;

      const totalPosts = taskCollections.reduce((sum, s) => sum + (s.postsCollected ?? 0), 0);
      mountContinuationFiredRef.current = true;
      sendSystemMessage(
        `[CONTINUE] All collections for task "${task.title ?? 'unknown'}" complete. ${totalPosts} posts collected and enriched. Resume remaining todos — analyze the data and deliver findings.`,
      );
      break; // Only continue one task at a time
    }
  }, [sendSystemMessage, messages.length]); // re-check when session loads (messages appear)
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
          <TaskProgressPill />
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
