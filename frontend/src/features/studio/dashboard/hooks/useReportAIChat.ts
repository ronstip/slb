import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { streamChat } from '../../../../api/sse-client.ts';
import { apiPost } from '../../../../api/client.ts';
import { getReportHistoryStore } from '../dashboard-history-store.ts';
import { buildCoAuthorMessage, type AttachedWidget } from '../coauthor-context.ts';
import type {
  LayoutResponse,
  LayoutSavePayload,
} from './useDashboardLayout.ts';

/** A message in the report-editor mini-chat. Local to the popover - never
 *  written to the global chat store, because this conversation is about the
 *  open report, not the user's main session. */
export interface ReportChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  /** Short, human-readable record of tool activity for transparency (e.g.
   *  "added a sentiment chart"). Rendered inline under the assistant message. */
  toolNotes?: string[];
  /** Set when an assistant turn surfaced an error. */
  error?: string;
  /** Titles of widgets the user pinned to this turn. Shown as chips under the
   *  user bubble so the conversation records what the request was scoped to. */
  attachments?: string[];
}

interface UseReportAIChatOptions {
  artifactId: string;
  agentId?: string;
  /** Fires after every successful update_dashboard, once the layout query
   *  has been refetched. The parent uses this to re-sync the grid's local
   *  widget state - without it, AI additions stay invisible until a manual
   *  page refresh. */
  onLayoutChanged?: () => void;
}

/** How long the "AI updated the report" toast stays up. Long enough that a
 *  user reading the message has comfortable time to click Undo. */
const UPDATE_TOAST_DURATION_MS = 12_000;

interface UseReportAIChatResult {
  messages: ReportChatMessage[];
  isStreaming: boolean;
  /** `displayText`, when given, is what the user bubble shows; `text` is what
   *  the model receives (e.g. a story request with a protocol preamble). */
  sendMessage: (
    text: string,
    attached?: AttachedWidget[],
    displayText?: string,
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Mini chat hook for the floating "AI" popover in the report top bar.
 *
 * Wraps the `/chat` SSE endpoint with `mode: "report_editor"` so the backend
 * picks the narrow widget-editing tool profile + prompt. Distinct from
 * `useSSEChat` (the global, full-featured analyst chat): this hook is
 * single-conversation, ephemeral, and dashboard-scoped.
 *
 * Side effects on a successful `update_dashboard` tool result:
 *   1. Snapshot the prior layout from React Query cache.
 *   2. Invalidate the layout query so the grid re-fetches the new state.
 *   3. Show a sonner toast with an Undo button that POSTs the snapshot back.
 */
export function useReportAIChat({
  artifactId,
  agentId,
  onLayoutChanged,
}: UseReportAIChatOptions): UseReportAIChatResult {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ReportChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Session id stable per (user, layout). FirestoreSessionService scopes by
  // user_id anyway, so different users can't collide on the same string.
  const sessionIdRef = useRef<string>(`report-editor:${artifactId}`);

  // Reset stream + session when the surrounding report changes (e.g. user
  // navigates between explorer layouts without unmounting the popover).
  useEffect(() => {
    sessionIdRef.current = `report-editor:${artifactId}`;
    return () => abortRef.current?.abort();
  }, [artifactId]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    // Bump the session id so the next turn starts a fresh server-side session,
    // not a resumption of the cleared one.
    sessionIdRef.current = `report-editor:${artifactId}:${Date.now()}`;
  }, [artifactId]);

  const sendMessage = useCallback(
    async (text: string, attached: AttachedWidget[] = [], displayText?: string) => {
      if (!text.trim() || isStreaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Sent to the model: focus preamble (if any pinned widgets) + the text.
      // Displayed to the user: just `text` - the preamble is machinery.
      const outgoing = buildCoAuthorMessage(text, attached);

      const userMsg: ReportChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: displayText ?? text,
        attachments: attached.length > 0 ? attached.map((w) => w.title) : undefined,
      };
      const assistantId = `a-${Date.now()}`;
      const assistantMsg: ReportChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        isStreaming: true,
        toolNotes: [],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const patchAssistant = (patch: Partial<ReportChatMessage>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        );
      };
      const appendText = (chunk: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + chunk } : m,
          ),
        );
      };
      const appendNote = (note: string) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const notes = m.toolNotes ?? [];
            // Collapse consecutive identical notes (e.g. three back-to-back
            // execute_sql calls -> "Running a quick query… (3)") so a multi-step
            // story turn doesn't spam the same line.
            const last = notes[notes.length - 1];
            const base = note.replace(/ \(\d+\)$/, '');
            if (last && last.replace(/ \(\d+\)$/, '') === base) {
              const match = last.match(/ \((\d+)\)$/);
              const count = match ? Number(match[1]) + 1 : 2;
              return {
                ...m,
                toolNotes: [...notes.slice(0, -1), `${base} (${count})`],
              };
            }
            return { ...m, toolNotes: [...notes, note] };
          }),
        );
      };

      try {
        const stream = streamChat(
          {
            message: outgoing,
            session_id: sessionIdRef.current,
            agent_id: agentId,
            mode: 'report_editor',
            active_dashboard_id: artifactId,
          },
          controller.signal,
        );

        for await (const event of stream) {
          if (controller.signal.aborted) break;

          switch (event.event_type) {
            case 'partial_text': {
              appendText(event.content);
              break;
            }
            case 'text': {
              // Final aggregated text replaces any partial we streamed in.
              // (The backend emits BOTH a partial stream and a final 'text';
              // when both fire, the partial chunks already contain the full
              // text. Treat 'text' as a no-op when partials streamed.)
              break;
            }
            case 'tool_call': {
              // Surface a one-liner so the user can see what the agent is doing.
              const name = event.metadata.name;
              if (name === 'read_dashboard') {
                appendNote('Reading current report…');
              } else if (name === 'update_dashboard') {
                appendNote('Applying changes…');
              } else if (name === 'list_topics') {
                appendNote('Checking topics in the data…');
              } else if (name === 'execute_sql') {
                appendNote('Running a quick query…');
              }
              break;
            }
            case 'tool_result': {
              const name = event.metadata.name;
              const result = event.metadata.result;
              if (!result) break;

              if (name === 'update_dashboard' && result.status === 'success') {
                void handleUpdateApplied(queryClient, artifactId, onLayoutChanged);
              } else if (
                name === 'update_dashboard' &&
                result.status === 'error'
              ) {
                const msg = (result.message as string) || 'Update failed.';
                // A schema/cross-field validation error is recoverable: the
                // agent gets the full tool_result and retries with a corrected
                // layout in the same turn. Surfacing a scary "Couldn't apply"
                // mid-stream (right before a successful retry) confused users,
                // so log it for debugging and stay quiet. Non-validation errors
                // (e.g. access denied) are terminal - show those.
                if (result.validation_errors) {
                  console.warn('update_dashboard validation error:', msg, result.validation_errors);
                } else {
                  appendNote(`Couldn't apply: ${msg}`);
                }
              }
              break;
            }
            case 'done': {
              patchAssistant({ isStreaming: false });
              break;
            }
            case 'error': {
              patchAssistant({
                isStreaming: false,
                error: event.content,
              });
              break;
            }
            default:
              break;
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const detail = err instanceof Error ? err.message : 'Unknown error';
          patchAssistant({
            isStreaming: false,
            error: `Connection error: ${detail}`,
          });
        }
      } finally {
        patchAssistant({ isStreaming: false });
        setIsStreaming(false);
      }
    },
    [artifactId, agentId, isStreaming, queryClient, onLayoutChanged],
  );

  return { messages, isStreaming, sendMessage, cancel, reset };
}

/**
 * Refetch the new layout, notify the parent, show toast with Undo.
 *
 * We `await refetchQueries` (not just `invalidateQueries`) before pulsing
 * `onLayoutChanged` so the grid's re-sync effect can read fresh widgets from
 * the cache. Invalidate alone makes the refetch happen in the background -
 * the parent would race ahead and re-sync to stale state.
 *
 * Once the resync runs, the per-artifact history store records the AI's
 * change as one undo step via `applyExternalSnapshot`. The toast's Undo
 * button piggybacks on that - it pops the entry and persists the restored
 * state - so it shares a single source of truth with Cmd+Z. Toast duration
 * is intentionally longer than the sonner default so a user has time to
 * read and click without rushing.
 */
async function handleUpdateApplied(
  queryClient: ReturnType<typeof useQueryClient>,
  artifactId: string,
  onLayoutChanged?: () => void,
): Promise<void> {
  const queryKey = ['dashboard-layout', artifactId];

  try {
    await queryClient.refetchQueries({ queryKey });
  } catch {
    // Refetch failed (auth, network) - proceed with notification anyway so
    // the user knows the server accepted the change; the grid will recover
    // on the next manual refresh.
  }
  onLayoutChanged?.();

  toast.success('AI updated the report', {
    duration: UPDATE_TOAST_DURATION_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        void undoAILayoutChange(queryClient, artifactId);
      },
    },
  });
}

/** Pop the AI's edit off the history stack and persist the restored state.
 *  Triggered from the toast - Cmd+Z goes through the toolbar handler in
 *  SocialDashboardView. Both call the same temporal store so the stacks
 *  stay coherent regardless of which path the user picks.
 *
 *  We deliberately update the React Query cache via setQueryData rather
 *  than pulsing onLayoutChanged (which would bump externalSyncKey and
 *  trigger the resync effect to push *another* past-state for the
 *  same logical edit). The temporal.undo() already updated the local
 *  store, so the grid re-renders correctly without any cache invalidation. */
async function undoAILayoutChange(
  queryClient: ReturnType<typeof useQueryClient>,
  artifactId: string,
): Promise<void> {
  const store = getReportHistoryStore(artifactId);
  const temporalState = store.temporal.getState();
  if (temporalState.pastStates.length === 0) {
    toast.error('Nothing left to undo');
    return;
  }
  temporalState.undo();
  const restored = store.getState();
  const cached = queryClient.getQueryData<LayoutResponse>([
    'dashboard-layout',
    artifactId,
  ]);
  const payload: LayoutSavePayload = {
    layout: restored.widgets,
    filterBarFilters: cached?.filterBarFilters ?? undefined,
    orientation: restored.orientation,
    reportScope: cached?.reportScope ?? null,
    filterBarHidden: restored.filterBarHidden,
  };
  try {
    const updated = await apiPost<LayoutResponse>(
      `/dashboard/layouts/${artifactId}`,
      payload,
    );
    queryClient.setQueryData<LayoutResponse>(
      ['dashboard-layout', artifactId],
      updated,
    );
    toast.success('Undone');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Undo failed';
    toast.error(msg);
  }
}
