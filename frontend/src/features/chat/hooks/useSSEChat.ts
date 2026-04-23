import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../../api/sse-client.ts';
import { useChatStore } from '../../../stores/chat-store.ts';
import type { ToolStartEntry } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useExplorerLayoutStore } from '../../../stores/explorer-layout-store.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import type { StructuredPromptResult } from '../../../api/types.ts';
import {
  INTERNAL_TOOLS,
  mapToolCall,
  mapToolResult,
  type MapperContext,
} from '../../../lib/event-mapper.ts';

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
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Access stores via getState() to avoid subscribing to reactive updates.
      // Action functions are stable references — no re-renders from store changes.
      const cs = useChatStore.getState();

      if (!opts?.isSystem) {
        cs.sendUserMessage(text);
      }

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

            case 'tool_call': {
              const toolName = event.metadata.name;
              const args = (event.metadata.args ?? {}) as Record<string, unknown>;
              const ctx = liveCtx();
              const entry = mapToolCall(toolName, args, ctx);
              if (entry) {
                chatState.appendActivityEntry(messageId, entry);
                chatState.appendActivityBlock(messageId, entry);
              }
              break;
            }

            case 'tool_result': {
              const toolName = event.metadata.name;
              const result = event.metadata.result;
              if (!result) break;

              // Look up the matching tool_start to thread description + compute duration.
              const log = chatState.messages.find((m) => m.id === messageId)?.activityLog ?? [];
              const startEntry = [...log].reverse().find(
                (e): e is ToolStartEntry => e.kind === 'tool_start' && e.toolName === toolName,
              );
              const durationMs = startEntry ? Date.now() - startEntry.ts : 0;
              const prevDescription = startEntry?.description;
              const msg = chatState.messages.find((m) => m.id === messageId);
              const prevTodos = msg?.todos ?? [];

              const patch = mapToolResult(
                toolName,
                result,
                prevDescription,
                prevTodos,
                durationMs,
                liveCtx(),
              );

              // Activity entry: replace the tool_start so the UI shows one row per tool.
              if (patch.activityEntry && !INTERNAL_TOOLS.has(toolName)) {
                chatState.replaceToolEntry(messageId, toolName, patch.activityEntry);
              }

              // Cards and artifacts.
              for (const card of patch.cards) {
                chatState.addCard(messageId, card);
              }
              for (const artifact of patch.artifacts) {
                useStudioStore.getState().addArtifact(artifact);
              }

              // Todo updates: use the store's updateTodos so it re-runs diff + pushes
              // todo_change entries into both flat log and chronological blocks.
              if (patch.todoUpdate) {
                chatState.updateTodos(messageId, patch.todoUpdate.newTodos);
              }

              // ── Live-only side effects, keyed by tool name / result shape ──
              if (result?.status === 'auth_required') {
                useUIStore.getState().openSignUpPrompt();
                break;
              }
              if (result?.status === 'blocked') break;

              if (toolName === 'export_data' && patch.artifacts[0]) {
                const exportId = patch.artifacts[0].id;
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport(exportId);
              } else if ((toolName === 'generate_dashboard' || toolName === 'compose_dashboard') && patch.artifacts[0]) {
                const dashboardArtifact = patch.artifacts[0];
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
                useStudioStore.getState().expandReport(dashboardArtifact.id);
                // compose_dashboard with an agent_id means an explorer layout was persisted —
                // surface it in the Explore sidebar without navigating away.
                const dashboardAgentId = result.agent_id as string | undefined;
                if (toolName === 'compose_dashboard' && dashboardAgentId) {
                  const nowIso = new Date().toISOString();
                  useExplorerLayoutStore.getState().upsertLayout({
                    layout_id: dashboardArtifact.id,
                    agent_id: dashboardAgentId,
                    title: dashboardArtifact.title,
                    created_at: nowIso,
                    updated_at: nowIso,
                  });
                }
              } else if (toolName === 'start_agent' || toolName === 'start_task') {
                if (result?.status === 'success') {
                  const cids = result.collection_ids as string[] | undefined;
                  const taskId = (result.agent_id as string) || (result.task_id as string) || undefined;
                  const currentSessionId = chatState.sessionId ?? undefined;
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
                        // Collection was just created — store a pending link and force a
                        // refetch so it enters the store (and polling) immediately rather
                        // than waiting for the 30s stale timer.
                        sourcesState.setPendingLink(cid, taskId, currentSessionId);
                        queryClient.invalidateQueries({ queryKey: ['collections'] });
                      }
                    }
                  }
                  if (taskId) {
                    createdTaskId = taskId;
                    navigate(`/agents/${taskId}?tab=chat`, { replace: true });
                  }
                  import('../../../stores/agent-store.ts').then(async ({ useAgentStore }) => {
                    await useAgentStore.getState().fetchAgents();
                    if (taskId) {
                      useAgentStore.getState().setActiveAgent(taskId);
                    }
                  });
                }
              } else if (toolName === 'ask_user' && result?.status === 'needs_input') {
                chatState.setActivePrompt(messageId);
                chatState.setActivePromptData(result as unknown as StructuredPromptResult);
              } else if (toolName === 'generate_presentation' && patch.artifacts[0]) {
                useUIStore.getState().expandStudioPanel();
                useStudioStore.getState().setActiveTab('artifacts');
              }
              break;
            }

            case 'done': {
              chatState.setSessionId(event.session_id);
              chatState.finalizeMessage(messageId);
              const sessionStore = useSessionStore.getState();
              const isNew = !sessionStore.sessions.some((s) => s.session_id === event.session_id);
              sessionStore.setActiveSession(event.session_id);
              if (event.session_title) {
                sessionStore.setActiveSessionTitle(event.session_title);
              }
              sessionStore.touchSession(event.session_id);
              if (isNew) {
                sessionStore.fetchSessions();
                if (createdTaskId) {
                  navigate(`/agents/${createdTaskId}?tab=chat`, { replace: true });
                }
                // If no task yet (e.g. ask_user approval still pending), stay on
                // the current page — AgentHome will show a ChatPanel for interaction.
              } else if (createdTaskId) {
                navigate(`/agents/${createdTaskId}?tab=chat`);
              }
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

/** Live MapperContext — wall-clock timestamps, Date.now-based fallback IDs. */
function liveCtx(): MapperContext {
  const now = Date.now();
  return {
    now,
    fallbackId: (kind) => kind === 'data_export' ? `artifact-${now}` : `${kind}-${now}`,
    dataExportSourceIds: useAgentStore.getState().activeAgent?.collection_ids ?? [],
  };
}
