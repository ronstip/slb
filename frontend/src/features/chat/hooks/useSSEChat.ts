import { useCallback, useRef } from 'react';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useAuth } from '../../../auth/useAuth.ts';
import { getToolDisplayText, isDesignResearchResult, isInsightResult, isProgressResult, isDataExportResult, isChartResult, isPostEmbedResult } from '../../../lib/event-parser.ts';
import type { InsightData, DataExportRow } from '../../../api/types.ts';

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const { getToken } = useAuth();

  const sendMessage = useCallback(
    async (text: string) => {
      // Abort any existing stream
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Access stores via getState() to avoid subscribing to reactive updates.
      // Action functions are stable references — no re-renders from store changes.
      const cs = useChatStore.getState();

      // Add user message
      cs.sendUserMessage(text);

      // Start agent message
      const messageId = cs.startAgentMessage();
      activeMessageRef.current = messageId;

      const selectedSources = useSourcesStore.getState().sources
        .filter((s) => s.selected)
        .map((s) => s.collectionId);

      try {
        const stream = streamChat(
          {
            message: text,
            session_id: cs.sessionId ?? undefined,
            selected_sources: selectedSources.length > 0 ? selectedSources : undefined,
          },
          getToken,
          abortController.signal,
        );

        for await (const event of stream) {
          if (abortController.signal.aborted) break;

          // Re-read from getState() to ensure fresh references
          const chatState = useChatStore.getState();

          // Track which agent is active (skip orchestrator — it's just routing)
          if ('author' in event && event.author && event.author !== 'orchestrator') {
            chatState.setActiveAgent(messageId, event.author);
          }

          switch (event.event_type) {
            case 'text':
              chatState.appendText(messageId, event.content);
              break;

            case 'thinking':
              chatState.appendThinking(messageId, event.content);
              break;

            case 'tool_call': {
              const toolName = event.metadata.name;
              chatState.addToolCall(messageId, toolName, getToolDisplayText(toolName));
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;
              chatState.resolveToolCall(messageId, toolName, result);

              // Handle special tool results
              if (isDesignResearchResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'research_design',
                  data: result,
                });
              } else if (isInsightResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'insight_summary',
                  data: result,
                });
                // Save to artifacts
                const collectionName = result.collection_name as string | undefined;
                useStudioStore.getState().addArtifact({
                  id: `artifact-${Date.now()}`,
                  type: 'insight_report',
                  title: collectionName ? `Insight Report: ${collectionName}` : 'Insight Report',
                  narrative: result.narrative as string,
                  data: result.data as InsightData,
                  dateFrom: (result.date_from as string) || null,
                  dateTo: (result.date_to as string) || null,
                  sourceIds: selectedSources,
                  createdAt: new Date(),
                });
              } else if (isDataExportResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'data_export',
                  data: result,
                });
                // Save to artifacts
                useStudioStore.getState().addArtifact({
                  id: `artifact-${Date.now()}`,
                  type: 'data_export',
                  title: 'Data Export',
                  rows: result.rows as DataExportRow[],
                  rowCount: result.row_count as number,
                  columnNames: result.column_names as string[],
                  sourceIds: selectedSources,
                  createdAt: new Date(),
                });
              } else if (isChartResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'chart',
                  data: result!,
                });
              } else if (isPostEmbedResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'post_embed',
                  data: result!,
                });
              } else if (isProgressResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'progress',
                  data: result!,
                });
              }
              break;
            }

            case 'done': {
              if (event.suggestions?.length) {
                chatState.setSuggestions(messageId, event.suggestions);
              }
              chatState.setSessionId(event.session_id);
              chatState.finalizeMessage(messageId);
              const sessionStore = useSessionStore.getState();
              const isNew = !sessionStore.sessions.some(s => s.session_id === event.session_id);
              sessionStore.setActiveSession(event.session_id);
              if (event.session_title) {
                sessionStore.setActiveSessionTitle(event.session_title);
              }
              // Only fetch full sessions list when this is a brand-new session
              if (isNew) sessionStore.fetchSessions();
              break;
            }

            case 'error':
              chatState.appendText(messageId, `\n\nError: ${event.content}`);
              chatState.finalizeMessage(messageId);
              break;
          }
        }
        // If stream ends without a 'done' event, finalize anyway
        useChatStore.getState().finalizeMessage(messageId);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const detail = err instanceof Error ? err.message : 'Unknown error';
          useChatStore.getState().appendText(messageId, `\n\nConnection error: ${detail}`);
        }
        useChatStore.getState().finalizeMessage(messageId);
      }
    },
    [getToken],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    if (activeMessageRef.current) {
      useChatStore.getState().finalizeMessage(activeMessageRef.current);
    }
  }, []);

  return { sendMessage, cancelStream };
}
