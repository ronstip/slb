/**
 * Reconstructs frontend UI state (chat messages, artifacts) from raw ADK
 * events stored in Firestore. This mirrors the logic in useSSEChat.ts but
 * operates on the persisted event format instead of live SSE events.
 *
 * Uses append-only activity log — tool_start / tool_complete / tool_error /
 * tool_blocked are separate entries; todo changes are diffed inline.
 */

import type { ChatMessage, TodoItem, ActivityEntry } from '../stores/chat-store.ts';
import type { Artifact } from '../stores/studio-store.ts';
import type { DataExportRow } from '../api/types.ts';
import type { RawADKEvent } from '../api/endpoints/sessions.ts';
import {
  getToolDisplayText,
  isDesignResearchResult,
  isDataExportResult,
  isChartResult,
  isDashboardResult,
  isStartAgentResult,
  isTodoResult,
  isStructuredPromptResult,
  isMetricsResult,
  isTopicsResult,
  isPresentationResult,
} from './event-parser.ts';

export interface ReconstructedSession {
  messages: ChatMessage[];
  artifacts: Artifact[];
  selectedSourceIds: string[];
}

let msgCounter = 0;
function nextId(): string {
  return `restored-${Date.now()}-${++msgCounter}`;
}

/** Diff old vs new todos and return todo_change activity entries. */
function diffTodos(oldTodos: TodoItem[], newTodos: TodoItem[], ts: number): ActivityEntry[] {
  const oldMap = new Map(oldTodos.map((t) => [t.id, t]));
  const changes: ActivityEntry[] = [];
  for (const t of newTodos) {
    const old = oldMap.get(t.id);
    if (!old) {
      changes.push({ kind: 'todo_change', ts, todoId: t.id, content: t.content, fromStatus: null, toStatus: t.status });
    } else if (old.status !== t.status) {
      changes.push({ kind: 'todo_change', ts, todoId: t.id, content: t.content, fromStatus: old.status, toStatus: t.status });
    }
  }
  return changes;
}

export function reconstructSession(
  events: RawADKEvent[],
  state: Record<string, unknown>,
): ReconstructedSession {
  const messages: ChatMessage[] = [];
  const artifacts: Artifact[] = [];
  let currentAgentMsg: ChatMessage | null = null;

  function flushAgent() {
    if (currentAgentMsg) {
      currentAgentMsg.isStreaming = false;
      messages.push(currentAgentMsg);
      currentAgentMsg = null;
    }
  }

  function ensureAgentMsg(timestamp?: number): ChatMessage {
    if (!currentAgentMsg) {
      currentAgentMsg = {
        id: nextId(),
        role: 'agent',
        content: '',
        timestamp: new Date(timestamp ? timestamp * 1000 : Date.now()),
        isStreaming: false,
        cards: [],
        todos: [],
        activityLog: [],
        blocks: [],
      };
    }
    return currentAgentMsg!;
  }

  for (const event of events) {
    if (!event.content?.parts) {
      console.debug('[reconstruct] skipping event without content.parts:', event.author);
      continue;
    }

    for (const part of event.content.parts) {
      // --- User message ---
      if (event.content.role === 'user' && part.text) {
        flushAgent();
        messages.push({
          id: nextId(),
          role: 'user',
          content: part.text,
          timestamp: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          isStreaming: false,
          cards: [],
          todos: [],
          activityLog: [],
          blocks: [],
        });
        continue;
      }

      // --- Tool call ---
      if (part.function_call) {
        if (part.function_call.name === 'transfer_to_agent') continue;
        const msg = ensureAgentMsg(event.timestamp);
        const ts = event.timestamp ? event.timestamp * 1000 : Date.now();
        msg.activityLog.push({ kind: 'tool_start', text: getToolDisplayText(part.function_call.name), toolName: part.function_call.name, ts });
        continue;
      }

      // --- Tool result ---
      if (part.function_response) {
        if (part.function_response.name === 'transfer_to_agent') continue;
        const toolName = part.function_response.name;
        const result = (part.function_response.response ?? {}) as Record<string, unknown>;
        const msg = ensureAgentMsg(event.timestamp);
        const ts = event.timestamp ? event.timestamp * 1000 : Date.now();

        // Compute duration from matching tool_start
        const startEntry = [...msg.activityLog].reverse().find(
          e => e.kind === 'tool_start' && e.toolName === toolName
        );
        const durationMs = startEntry ? ts - startEntry.ts : 0;

        // Append completion/error/blocked entry
        if (result?.status === 'blocked' || result?.status === 'auth_required') {
          msg.activityLog.push({ kind: 'tool_blocked', toolName, text: getToolDisplayText(toolName), ts });
        } else if (result?.status === 'error') {
          msg.activityLog.push({ kind: 'tool_error', toolName, text: getToolDisplayText(toolName), error: (result?.message as string) || 'Failed', durationMs, ts });
        } else {
          msg.activityLog.push({ kind: 'tool_complete', toolName, text: getToolDisplayText(toolName), durationMs, ts });
        }

        // Create cards + artifacts (mirrors useSSEChat logic)
        if (isDesignResearchResult(toolName, result)) {
          console.debug('[reconstruct] research_design card created from', toolName);
          msg.cards.push({ type: 'research_design', data: result });
        } else if (isChartResult(toolName, result)) {
          const chartId = (result._artifact_id as string) || `chart-restored-${artifacts.length}`;
          msg.cards.push({ type: 'chart', data: { ...result, _artifactId: chartId } });
          artifacts.push({
            id: chartId,
            type: 'chart',
            title: (result.title as string) || 'Chart',
            chartType: result.chart_type as string,
            data: (result.data as Record<string, unknown>) ?? {},
            barOrientation: (result.bar_orientation as string | undefined) || undefined,
            collectionIds: (result.collection_ids as string[] | undefined) ?? undefined,
            sourceSql: (result.source_sql as string | undefined) || undefined,
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isDataExportResult(toolName, result)) {
          const exportId = (result._artifact_id as string) || `artifact-restored-${artifacts.length}`;
          msg.cards.push({ type: 'data_export', data: { ...result, _artifactId: exportId } });
          artifacts.push({
            id: exportId,
            type: 'data_export',
            title: 'Data Export',
            rows: result.rows as DataExportRow[],
            rowCount: result.row_count as number,
            columnNames: result.column_names as string[],
            sourceIds: (state.agent_selected_sources as string[]) || [],
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isDashboardResult(toolName, result)) {
          msg.cards.push({ type: 'dashboard', data: result });
          artifacts.push({
            id: (result._artifact_id as string) || (result.dashboard_id as string) || `dashboard-restored-${artifacts.length}`,
            type: 'dashboard',
            title: result.title as string,
            collectionIds: result.collection_ids as string[],
            collectionNames: result.collection_names as Record<string, string>,
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isStartAgentResult(toolName, result)) {
          // start_agent doesn't produce a card — it's an action, not a UI element.
          // Collections were already added to sources during the live session.
        } else if (isStructuredPromptResult(toolName, result)) {
          // Show the answered structured prompt card (read-only — already submitted)
          msg.cards.push({ type: 'structured_prompt', data: result });
        } else if (isTodoResult(toolName, result)) {
          // Diff old vs new todos and append todo_change entries
          const newTodos = (result.todos as Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>) ?? [];
          const changes = diffTodos(msg.todos, newTodos, ts);
          msg.activityLog.push(...changes);
          msg.todos = newTodos;
        } else if (isMetricsResult(toolName, result)) {
          msg.cards.push({ type: 'metrics_section', data: result });
        } else if (isTopicsResult(toolName, result)) {
          msg.cards.push({ type: 'topics_section', data: result });
        } else if (isPresentationResult(toolName, result)) {
          artifacts.push({
            id: (result._artifact_id as string) || (result.presentation_id as string) || `ppt-restored-${artifacts.length}`,
            type: 'presentation',
            title: result.title as string,
            collectionIds: (result.collection_ids as string[]) || [],
            slideCount: (result.slide_count as number) || 0,
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        }
        continue;
      }

      // --- Agent text ---
      if (part.text && event.content.role !== 'user' && !part.thought) {
        const msg = ensureAgentMsg(event.timestamp);
        // Strip any stray HTML comments from visible text
        const cleanText = part.text.replace(/<!--[\s\S]*?-->/g, '');
        msg.content += cleanText;
      }
    }
  }

  // Flush any remaining agent message
  flushAgent();

  return {
    messages,
    artifacts,
    selectedSourceIds: (state.agent_selected_sources as string[]) || [],
  };
}
