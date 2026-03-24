import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useAuth } from '../../../auth/useAuth.ts';
import { getToolDisplayText, isDesignResearchResult, isDataExportResult, isChartResult, isReportResult, isDashboardResult, isStructuredPromptResult, isTaskProtocolResult, isTodoResult } from '../../../lib/event-parser.ts';
import type { DataExportRow, ReportCard, StructuredPromptResult } from '../../../api/types.ts';

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const navigate = useNavigate();

  // Clean up refs on unmount to prevent stale message finalization
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      activeMessageRef.current = null;
    };
  }, []);

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
        .filter((s) => s.active)
        .map((s) => s.collectionId);

      try {
        const stream = streamChat(
          {
            message: text,
            session_id: cs.sessionId ?? undefined,
            selected_sources: selectedSources,
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
            case 'partial_text': {
              // Streaming text chunk — append directly for typewriter effect.
              // Markers are invisible (remarkStripComments strips HTML comments).
              chatState.setStatusLine(messageId, null);
              chatState.appendText(messageId, event.content);
              break;
            }

            case 'text': {
              // Final aggregated text — extract thinking markers.
              // The visible text was already streamed via partial_text events,
              // so we only process markers here (text is suppressed server-side).
              const thinkingRe = /<!--\s*thinking:\s*([\s\S]*?)\s*-->/g;
              let thinkingMatch;
              while ((thinkingMatch = thinkingRe.exec(event.content)) !== null) {
                chatState.appendThinking(messageId, thinkingMatch[1].trim());
              }
              const cleanText = event.content.replace(/<!--\s*thinking:\s*[\s\S]*?\s*-->/g, '').trimEnd();
              if (cleanText) {
                // Clear status line once real text arrives
                chatState.setStatusLine(messageId, null);
                chatState.appendText(messageId, cleanText);
              }
              break;
            }

            case 'thinking':
              chatState.appendThinking(messageId, event.content);
              break;

            case 'status':
              chatState.setStatusLine(messageId, event.content);
              break;

            case 'intent':
              chatState.setIntentLine(messageId, event.content);
              break;

            case 'needs_decision':
              chatState.addCard(messageId, {
                type: 'decision',
                data: event.metadata,
              });
              break;

            case 'finding':
              chatState.addCard(messageId, {
                type: 'finding',
                data: event.metadata,
              });
              break;

            case 'plan':
              chatState.addCard(messageId, {
                type: 'plan',
                data: event.metadata,
              });
              break;

            case 'topics_section':
              chatState.addCard(messageId, {
                type: 'topics_section',
                data: event.metadata,
              });
              break;

            case 'metrics_section':
              chatState.addCard(messageId, {
                type: 'metrics_section',
                data: event.metadata,
              });
              break;

            case 'context_update': {
              // Agent changed its working collection set — validate IDs exist
              try {
                const sourcesState = useSourcesStore.getState();
                const knownIds = new Set(sourcesState.sources.map((s) => s.collectionId));
                const validIds = (event.agent_selected_sources ?? []).filter((id: string) => {
                  if (!knownIds.has(id)) {
                    console.warn(`[context_update] Unknown collection ID from agent: ${id}`);
                    return false;
                  }
                  return true;
                });
                sourcesState.setAgentSelectedSources(validIds);
              } catch (err) {
                console.error('[context_update] Failed to process agent context update:', err);
              }
              break;
            }

            case 'tool_call': {
              const toolName = event.metadata.name;
              chatState.addToolCall(messageId, toolName, getToolDisplayText(toolName));
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;

              // Blocked tool calls (e.g. gate rejected) — remove the indicator silently
              if (result?.status === 'blocked') {
                chatState.removeToolCall(messageId, toolName);
                break;
              }

              // Anonymous user tried to start a collection — open sign-up prompt
              if (result?.status === 'auth_required') {
                chatState.removeToolCall(messageId, toolName);
                useUIStore.getState().openSignUpPrompt();
                break;
              }

              chatState.resolveToolCall(messageId, toolName, result);

              // Handle special tool results
              if (isDesignResearchResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'research_design',
                  data: result,
                });
              } else if (isDataExportResult(toolName, result)) {
                const exportId = (result._artifact_id as string) || `artifact-${Date.now()}`;
                chatState.addCard(messageId, {
                  type: 'data_export',
                  data: { ...result, _artifactId: exportId },
                });
                // Auto-save to artifacts
                useStudioStore.getState().addArtifact({
                  id: exportId,
                  type: 'data_export',
                  title: 'Data Export',
                  rows: result.rows as DataExportRow[],
                  rowCount: result.row_count as number,
                  columnNames: result.column_names as string[],
                  sourceIds: selectedSources,
                  createdAt: new Date(),
                });
                // Open studio panel, switch to artifacts, expand the export
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport(exportId);
              } else if (isChartResult(toolName, result)) {
                const chartId = (result?._artifact_id as string) || `chart-${Date.now()}`;
                chatState.addCard(messageId, {
                  type: 'chart',
                  data: { ...result, _artifactId: chartId },
                });
                // Auto-save chart as artifact
                useStudioStore.getState().addArtifact({
                  id: chartId,
                  type: 'chart',
                  title: (result?.title as string) || 'Chart',
                  chartType: result?.chart_type as string,
                  data: result?.data as unknown[],
                  collectionIds: (result?.collection_ids as string[] | undefined) ?? undefined,
                  filterSql: (result?.filter_sql as string | undefined) || undefined,
                  sourceSql: (result?.source_sql as string | undefined) || undefined,
                  createdAt: new Date(),
                });
                // Open studio panel, switch to artifacts, expand the chart
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport(chartId);
              } else if (isReportResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'insight_report',
                  data: result,
                });
                // Auto-save to artifacts
                useStudioStore.getState().addArtifact({
                  id: (result._artifact_id as string) || (result.report_id as string),
                  type: 'insight_report',
                  title: result.title as string,
                  collectionIds: (result.collection_ids as string[] | undefined) ?? (result.collection_id ? [result.collection_id as string] : undefined),
                  collectionId: result.collection_id as string | undefined,
                  dateFrom: result.date_from as string | undefined,
                  dateTo: result.date_to as string | undefined,
                  cards: result.cards as ReportCard[],
                  createdAt: new Date(),
                });
                // Open studio panel, switch to artifacts, expand the report
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport((result._artifact_id as string) || (result.report_id as string));
              } else if (isDashboardResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'dashboard',
                  data: result,
                });
                // Auto-save dashboard artifact
                useStudioStore.getState().addArtifact({
                  id: (result._artifact_id as string) || (result.dashboard_id as string),
                  type: 'dashboard',
                  title: result.title as string,
                  collectionIds: result.collection_ids as string[],
                  collectionNames: result.collection_names as Record<string, string>,
                  createdAt: new Date(),
                });
                // Open studio panel, switch to artifacts, expand the dashboard
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport((result._artifact_id as string) || (result.dashboard_id as string));
              } else if (isTaskProtocolResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'task_protocol',
                  data: result,
                });
              } else if (isTodoResult(toolName, result)) {
                // Replace previous todo card in this message (only show latest state)
                const msg = chatState.messages.find((m) => m.id === messageId);
                const existingIdx = msg?.cards.findIndex((c) => c.type === 'todo') ?? -1;
                if (existingIdx >= 0) {
                  chatState.updateCard(messageId, existingIdx, result);
                } else {
                  chatState.addCard(messageId, { type: 'todo', data: result });
                }
              } else if (isStructuredPromptResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'structured_prompt',
                  data: result,
                });
                chatState.setActivePrompt(messageId);
                chatState.setActivePromptData(result as unknown as StructuredPromptResult);
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
              // Update sorting timestamp so this session floats to the top
              sessionStore.touchSession(event.session_id);
              if (isNew) {
                // New session created — fetch list and update URL
                sessionStore.fetchSessions();
                navigate(`/session/${event.session_id}`, { replace: true });
              }
              break;
            }

            case 'error':
              chatState.appendText(messageId, `\n\nError: ${event.content}`);
              chatState.finalizeMessage(messageId);
              break;
          }
        }
        // If stream ends without a 'done' event, finalize anyway
        const msg = useChatStore.getState().messages.find((m) => m.id === messageId);
        if (msg?.isStreaming) {
          useChatStore.getState().finalizeMessage(messageId);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const detail = err instanceof Error ? err.message : 'Unknown error';
          useChatStore.getState().appendText(messageId, `\n\nConnection error: ${detail}`);
        }
        useChatStore.getState().finalizeMessage(messageId);
      }
    },
    [getToken, navigate],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    if (activeMessageRef.current) {
      useChatStore.getState().finalizeMessage(activeMessageRef.current);
    }
  }, []);

  return { sendMessage, cancelStream };
}
