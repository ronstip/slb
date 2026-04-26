import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useSSEChat } from './hooks/useSSEChat.ts';
import { MessageList } from './MessageList.tsx';
import { MessageInput } from './MessageInput.tsx';
import { WelcomeScreen } from './WelcomeScreen.tsx';
import { TaskSelector } from './TaskSelector.tsx';
import { StructuredPromptPanel } from './StructuredPromptPanel.tsx';
import { TaskProgressPill } from './TaskProgressPill.tsx';

interface ChatPanelProps {
  hideHeader?: boolean;
  hideWelcome?: boolean;
  /** Rendered in place of the message list when there are no messages yet. Implies `hideWelcome`. */
  emptyStateContent?: ReactNode;
  /** Embedded variant: tighter padding, smaller input bar, smaller send button. */
  compact?: boolean;
}

export function ChatPanel({ hideHeader, hideWelcome, emptyStateContent, compact = false }: ChatPanelProps = {}) {
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
    const TERMINAL = new Set(['success', 'failed']);

    for (const task of tasks) {
      if (task.status !== 'running') continue;
      if (!task.session_ids?.includes(sessionId)) continue;

      // Verify all collections are terminal
      const taskCollections = sources.filter((s) => s.taskId === task.agent_id);
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
    <main data-testid="chat-panel" className={cn('flex flex-1 flex-col overflow-hidden bg-background', compact ? 'compact-chat' : 'min-w-[480px]')}>
      {/* Top bar — collection + task selectors */}
      {!hideHeader && (
        <div className="flex shrink-0 items-center gap-2 px-4 py-2">
          <TaskSelector />
        </div>
      )}

      {isRestoring ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hasMessages || hideWelcome || emptyStateContent ? (
        <>
          {hasMessages ? (
            <MessageList onSendMessage={sendMessage} compact={compact} />
          ) : emptyStateContent ? (
            <div className={cn('flex-1 overflow-y-auto', compact ? 'px-5 py-4' : 'px-6 py-4')}>
              <div className="mx-auto max-w-5xl">{emptyStateContent}</div>
            </div>
          ) : (
            <MessageList onSendMessage={sendMessage} compact={compact} />
          )}
          <TaskProgressPill />
          {activePromptData ? (
            <StructuredPromptPanel onSubmit={sendMessage} onCancel={cancelPrompt} />
          ) : (
            <MessageInput onSend={sendMessage} onCancel={cancelStream} compact={compact} />
          )}
        </>
      ) : (
        <WelcomeScreen onSend={sendMessage} />
      )}
    </main>
  );
}
