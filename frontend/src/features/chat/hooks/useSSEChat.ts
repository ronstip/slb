import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useAuth } from '../../../auth/useAuth.ts';
import { getToolDisplayText, isDesignResearchResult, isDataExportResult, isChartResult, isReportResult, isDashboardResult, isStructuredPromptResult, isStartTaskResult, isTodoResult, isMetricsResult, isTopicsResult } from '../../../lib/event-parser.ts';
import type { DataExportRow, ReportCard, StructuredPromptResult } from '../../../api/types.ts';

// Auto-generated thinking entries from backend _build_thinking_content() — system noise, not agent reasoning
const AUTO_THINKING_NOISE = new Set([
  'Query completed', 'Search results received', 'Research design complete',
  'Collection started', 'Progress retrieved', 'Enrichment complete',
  'Collection details loaded', 'Chart created', 'Report generated',
  'Dashboard built', 'Data exported', 'Task started', 'Task status retrieved',
  'Task context loaded', 'Engagements refreshed', 'Collection cancelled',
  'Email composed', 'Email sent',
]);

// Tools that are internal plumbing — skip from activity log
const INTERNAL_TOOLS = new Set(['update_todos', 'set_working_collections']);

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Clean up refs on unmount to prevent stale message finalization
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      activeMessageRef.current = null;
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string, opts?: { isSystem?: boolean }) => {
      // Abort any existing stream
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Access stores via getState() to avoid subscribing to reactive updates.
      // Action functions are stable references — no re-renders from store changes.
      const cs = useChatStore.getState();

      // Add user message (skip for system-generated messages)
      if (!opts?.isSystem) {
        cs.sendUserMessage(text);
      }

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
            is_system: opts?.isSystem,
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
              chatState.appendText(messageId, event.content);
              break;
            }

            case 'text': {
              // Final aggregated text — strip markers, append clean text only.
              // Thinking markers are handled via dedicated SSE thinking events.
              const cleanText = event.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd();
              if (cleanText) {
                chatState.appendText(messageId, cleanText);
              }
              break;
            }

            case 'thinking': {
              // Skip auto-generated system noise — only log real agent reasoning
              if (!AUTO_THINKING_NOISE.has(event.content) && !event.content.startsWith('Running SQL query')) {
                chatState.appendActivityEntry(messageId, { kind: 'thinking', text: event.content, ts: Date.now() });
              }
              break;
            }

            // Removed marker-based events (status, intent, suggestions).
            // Native Gemini thinking replaces markers; tools handle the rest.

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
              if (!INTERNAL_TOOLS.has(toolName)) {
                chatState.appendActivityEntry(messageId, { kind: 'tool_start', text: getToolDisplayText(toolName), toolName, ts: Date.now() });
              }
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;

              // Compute duration from matching tool_start entry
              const log = useChatStore.getState().messages.find(m => m.id === messageId)?.activityLog ?? [];
              const startEntry = [...log].reverse().find(
                e => e.kind === 'tool_start' && e.toolName === toolName
              );
              const durationMs = startEntry ? Date.now() - startEntry.ts : 0;

              // Blocked tool calls (e.g. gate rejected)
              if (result?.status === 'blocked') {
                chatState.appendActivityEntry(messageId, { kind: 'tool_blocked', toolName, text: getToolDisplayText(toolName), ts: Date.now() });
                break;
              }

              // Anonymous user tried to start a collection — open sign-up prompt
              if (result?.status === 'auth_required') {
                chatState.appendActivityEntry(messageId, { kind: 'tool_blocked', toolName, text: getToolDisplayText(toolName), ts: Date.now() });
                useUIStore.getState().openSignUpPrompt();
                break;
              }

              // Append completion or error entry
              const errorMsg = result?.status === 'error' ? ((result?.message as string) || 'Failed') : undefined;
              if (errorMsg) {
                chatState.appendActivityEntry(messageId, { kind: 'tool_error', toolName, text: getToolDisplayText(toolName), error: errorMsg, durationMs, ts: Date.now() });
              } else {
                chatState.appendActivityEntry(messageId, { kind: 'tool_complete', toolName, text: getToolDisplayText(toolName), durationMs, ts: Date.now() });
              }

              // Handle special tool results
              if (!result) break;
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
                // Save chart as artifact (no auto-open — chart renders inline)
                useStudioStore.getState().addArtifact({
                  id: chartId,
                  type: 'chart',
                  title: (result?.title as string) || 'Chart',
                  chartType: result?.chart_type as string,
                  data: (result?.data as Record<string, unknown>) ?? {},
                  barOrientation: (result?.bar_orientation as string | undefined) || undefined,
                  stacked: result?.stacked as boolean | undefined,
                  collectionIds: (result?.collection_ids as string[] | undefined) ?? undefined,
                  sourceSql: (result?.source_sql as string | undefined) || undefined,
                  createdAt: new Date(),
                });
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
              } else if (isStartTaskResult(toolName, result)) {
                // Task started — add collections to sources and link taskId + sessionId
                const cids = result.collection_ids as string[] | undefined;
                const taskId = result.task_id as string | undefined;
                const currentSessionId = useChatStore.getState().sessionId ?? undefined;
                if (cids?.length) {
                  for (const cid of cids) {
                    const sourcesState = useSourcesStore.getState();
                    const alreadyInStore = sourcesState.sources.some((s) => s.collectionId === cid);
                    if (alreadyInStore) {
                      sourcesState.addToSession(cid);
                      if (taskId) {
                        sourcesState.updateSource(cid, { taskId, sessionId: currentSessionId });
                      }
                    } else if (taskId) {
                      // Collection was just created — store a pending link to be applied
                      // when useCollectionsSync next syncs this collection into the store.
                      // Then force an immediate refetch so the collection enters the store
                      // (and polling) without waiting for the 30s stale timer.
                      sourcesState.setPendingLink(cid, taskId, currentSessionId);
                      queryClient.invalidateQueries({ queryKey: ['collections'] });
                    }
                  }
                }
                // Refresh task list, then set newly created task as active context
                import('../../../stores/task-store.ts').then(async ({ useTaskStore }) => {
                  await useTaskStore.getState().fetchTasks();
                  if (taskId) {
                    useTaskStore.getState().setActiveTask(taskId);
                  }
                });
              } else if (isTodoResult(toolName, result)) {
                // Update todos on the message — diff logic in updateTodos auto-appends todo_change entries
                const todos = (result.todos as Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>) ?? [];
                chatState.updateTodos(messageId, todos);
              } else if (isMetricsResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'metrics_section',
                  data: result,
                });
              } else if (isTopicsResult(toolName, result)) {
                chatState.addCard(messageId, {
                  type: 'topics_section',
                  data: result,
                });
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

  /** Send a system-generated message (no user bubble, full event processing). */
  const sendSystemMessage = useCallback(
    (text: string) => sendMessage(text, { isSystem: true }),
    [sendMessage],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    if (activeMessageRef.current) {
      useChatStore.getState().finalizeMessage(activeMessageRef.current);
    }
  }, []);

  return { sendMessage, sendSystemMessage, cancelStream };
}
