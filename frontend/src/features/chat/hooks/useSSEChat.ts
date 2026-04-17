import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { getToolDisplayText, isDesignResearchResult, isDataExportResult, isChartResult, isReportResult, isDashboardResult, isStructuredPromptResult, isStartAgentResult, isTodoResult, isMetricsResult, isTopicsResult, isPresentationResult } from '../../../lib/event-parser.ts';
import type { DataExportRow, ReportCard, StructuredPromptResult } from '../../../api/types.ts';

// Tools that are internal plumbing — skip from activity log
const INTERNAL_TOOLS = new Set(['update_todos']);

/** Extract a short description from tool_call args for display below the header. */
function getToolDescription(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'execute_sql': {
      const q = (args.query ?? args.sql ?? '') as string;
      return q ? (q.length > 120 ? q.slice(0, 120) + '...' : q) : undefined;
    }
    case 'google_search':
    case 'google_search_agent':
      return (args.query as string) || undefined;
    case 'design_research':
      return (args.question as string) || (args.research_question as string) || undefined;
    case 'get_progress':
    case 'enrich_collection':
    case 'cancel_collection':
    case 'get_collection_details':
    case 'refresh_engagements':
      return (args.collection_id as string) || undefined;
    case 'get_agent_status':
    case 'set_active_agent':
      return (args.agent_id as string) || (args.task_id as string) || undefined;
    case 'create_chart':
    case 'generate_report':
    case 'generate_dashboard':
    case 'generate_presentation':
      return (args.title as string) || undefined;
    case 'export_data':
      return (args.format as string) || undefined;
    default:
      return undefined;
  }
}

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const { theme, accentColor } = useTheme();
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

      let createdTaskId: string | undefined;

      try {
        const resolvedTheme = theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : theme;

        const stream = streamChat(
          {
            message: text,
            session_id: cs.sessionId ?? undefined,
            agent_id: useAgentStore.getState().activeAgentId ?? undefined,
            is_system: opts?.isSystem,
            accent_color: accentColor,
            theme: resolvedTheme,
          },
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
              chatState.appendTextBlock(messageId, event.content);
              break;
            }

            case 'text': {
              // Final aggregated text — strip markers, append clean text only.
              const cleanText = event.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd();
              if (cleanText) {
                chatState.appendTextBlock(messageId, cleanText);
              }
              break;
            }

            case 'thinking': {
              const entry = { kind: 'thinking' as const, text: event.content, ts: Date.now() };
              chatState.appendActivityEntry(messageId, entry);
              chatState.appendActivityBlock(messageId, entry);
              break;
            }

            // Removed marker-based events (status, intent, suggestions).
            // Native Gemini thinking replaces markers; tools handle the rest.

            case 'tool_call': {
              const toolName = event.metadata.name;
              if (!INTERNAL_TOOLS.has(toolName)) {
                const args = (event.metadata.args ?? {}) as Record<string, unknown>;
                const description = getToolDescription(toolName, args);
                const entry = { kind: 'tool_start' as const, text: getToolDisplayText(toolName), toolName, description, ts: Date.now() };
                chatState.appendActivityEntry(messageId, entry);
                chatState.appendActivityBlock(messageId, entry);
              }
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;

              // Internal tools skip activity entries but still process special results below
              if (!INTERNAL_TOOLS.has(toolName)) {
                // Compute duration and carry description from matching tool_start entry
                const log = useChatStore.getState().messages.find(m => m.id === messageId)?.activityLog ?? [];
                const startEntry = [...log].reverse().find(
                  e => e.kind === 'tool_start' && e.toolName === toolName
                );
                const durationMs = startEntry ? Date.now() - startEntry.ts : 0;
                const description = startEntry?.kind === 'tool_start' ? startEntry.description : undefined;

                // Blocked tool calls (e.g. gate rejected) — replace start entry
                if (result?.status === 'blocked') {
                  const entry = { kind: 'tool_blocked' as const, toolName, text: getToolDisplayText(toolName), ts: Date.now() };
                  chatState.replaceToolEntry(messageId, toolName, entry);
                  break;
                }

                // Anonymous user tried to start a collection — replace start entry + open sign-up
                if (result?.status === 'auth_required') {
                  const entry = { kind: 'tool_blocked' as const, toolName, text: getToolDisplayText(toolName), ts: Date.now() };
                  chatState.replaceToolEntry(messageId, toolName, entry);
                  useUIStore.getState().openSignUpPrompt();
                  break;
                }

                // Replace tool_start with completion or error entry
                const errorMsg = result?.status === 'error' ? ((result?.message as string) || 'Failed') : undefined;
                if (errorMsg) {
                  const entry = { kind: 'tool_error' as const, toolName, text: getToolDisplayText(toolName), error: errorMsg, durationMs, ts: Date.now() };
                  chatState.replaceToolEntry(messageId, toolName, entry);
                } else {
                  const entry = { kind: 'tool_complete' as const, toolName, text: getToolDisplayText(toolName), durationMs, description, ts: Date.now() };
                  chatState.replaceToolEntry(messageId, toolName, entry);
                }
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
                  sourceIds: useAgentStore.getState().activeAgent?.collection_ids ?? [],
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
              } else if (isStartAgentResult(toolName, result)) {
                // Task started — add collections to sources and link taskId + sessionId
                const cids = result.collection_ids as string[] | undefined;
                const taskId = (result.agent_id as string) || (result.task_id as string) || undefined;
                const currentSessionId = useChatStore.getState().sessionId ?? undefined;
                if (cids?.length) {
                  for (const cid of cids) {
                    const sourcesState = useSourcesStore.getState();
                    const alreadyInStore = sourcesState.sources.some((s) => s.collectionId === cid);
                    if (alreadyInStore) {
                      sourcesState.updateSource(cid, { selected: true, active: true });
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
                if (taskId) {
                  createdTaskId = taskId;
                  // Navigate immediately to the agent's chat tab so users don't stay
                  // stuck on AgentHome waiting for the stream to complete.
                  navigate(`/agents/${taskId}?tab=chat`, { replace: true });
                }
                // Refresh task list, then set newly created task as active context
                import('../../../stores/agent-store.ts').then(async ({ useAgentStore }) => {
                  await useAgentStore.getState().fetchAgents();
                  if (taskId) {
                    useAgentStore.getState().setActiveAgent(taskId);
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
              } else if (isPresentationResult(toolName, result)) {
                const presentationId = (result._artifact_id as string) || (result.presentation_id as string);
                useStudioStore.getState().addArtifact({
                  id: presentationId,
                  type: 'presentation',
                  title: (result.title as string) || 'Presentation',
                  collectionIds: (result.collection_ids as string[]) || [],
                  slideCount: (result.slide_count as number) || 0,
                  createdAt: new Date(),
                });
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
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
                if (createdTaskId) {
                  navigate(`/agents/${createdTaskId}?tab=chat`, { replace: true });
                }
                // If no task yet (e.g. ask_user approval still pending), stay on
                // the current page — AgentHome will show a ChatPanel for interaction.
              } else if (createdTaskId) {
                navigate(`/agents/${createdTaskId}?tab=chat`);
              }
              // Refresh agent session list so the new/updated session appears in sidebar
              const agentId = useAgentStore.getState().activeAgentId;
              if (agentId) {
                sessionStore.fetchAgentSessions(agentId);
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
    [navigate],
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
