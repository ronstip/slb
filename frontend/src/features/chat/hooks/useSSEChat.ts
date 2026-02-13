import { useCallback, useRef } from 'react';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useAuth } from '../../../auth/useAuth.ts';
import { getToolDisplayText, isDesignResearchResult, isInsightResult, isProgressResult } from '../../../lib/event-parser.ts';
import type { CollectionConfig, InsightData } from '../../../api/types.ts';

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const chatStore = useChatStore();
  const openCollectionModal = useUIStore((s) => s.openCollectionModal);
  const addArtifact = useStudioStore((s) => s.addArtifact);

  const sendMessage = useCallback(
    async (text: string) => {
      // Abort any existing stream
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Add user message
      chatStore.sendUserMessage(text);

      // Start agent message
      const messageId = chatStore.startAgentMessage();
      activeMessageRef.current = messageId;

      const selectedSources = useSourcesStore.getState().sources
        .filter((s) => s.selected)
        .map((s) => s.collectionId);
      const userId = useUIStore.getState().userId;

      try {
        const stream = streamChat(
          {
            message: text,
            user_id: userId,
            session_id: chatStore.sessionId ?? undefined,
            selected_sources: selectedSources.length > 0 ? selectedSources : undefined,
          },
          getToken,
          abortController.signal,
        );

        for await (const event of stream) {
          if (abortController.signal.aborted) break;

          switch (event.event_type) {
            case 'text':
              chatStore.appendText(messageId, event.content);
              break;

            case 'tool_call': {
              const toolName = event.metadata.name;
              chatStore.addToolCall(messageId, toolName, getToolDisplayText(toolName));
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;
              chatStore.resolveToolCall(messageId, toolName, result);

              // Handle special tool results
              if (isDesignResearchResult(toolName, result)) {
                chatStore.addCard(messageId, {
                  type: 'research_design',
                  data: result,
                });
                openCollectionModal(result.config as CollectionConfig);
              } else if (isInsightResult(toolName, result)) {
                chatStore.addCard(messageId, {
                  type: 'insight_summary',
                  data: result,
                });
                // Save to artifacts
                addArtifact({
                  id: `artifact-${Date.now()}`,
                  type: 'insight_report',
                  title: 'Insight Report',
                  narrative: result.narrative as string,
                  data: result.data as InsightData,
                  sourceIds: selectedSources,
                  createdAt: new Date(),
                });
              } else if (isProgressResult(toolName, result)) {
                chatStore.addCard(messageId, {
                  type: 'progress',
                  data: result!,
                });
              }
              break;
            }

            case 'done':
              chatStore.setSessionId(event.session_id);
              chatStore.finalizeMessage(messageId);
              break;

            case 'error':
              chatStore.appendText(messageId, `\n\nError: ${event.content}`);
              chatStore.finalizeMessage(messageId);
              break;
          }
        }
        // If stream ends without a 'done' event, finalize anyway
        chatStore.finalizeMessage(messageId);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const detail = err instanceof Error ? err.message : 'Unknown error';
          chatStore.appendText(messageId, `\n\nConnection error: ${detail}`);
        }
        chatStore.finalizeMessage(messageId);
      }
    },
    [chatStore, getToken, openCollectionModal, addArtifact],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    if (activeMessageRef.current) {
      chatStore.finalizeMessage(activeMessageRef.current);
    }
  }, [chatStore]);

  return { sendMessage, cancelStream };
}
