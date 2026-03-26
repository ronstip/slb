/**
 * Reconstructs frontend UI state (chat messages, artifacts) from raw ADK
 * events stored in Firestore. This mirrors the logic in useSSEChat.ts but
 * operates on the persisted event format instead of live SSE events.
 */

import type { ChatMessage } from '../stores/chat-store.ts';
import type { Artifact } from '../stores/studio-store.ts';
import type { DataExportRow, ReportCard } from '../api/types.ts';
import type { RawADKEvent } from '../api/endpoints/sessions.ts';
import {
  getToolDisplayText,
  isDesignResearchResult,
  isDataExportResult,
  isChartResult,
  isReportResult,
  isDashboardResult,
  isStartTaskResult,
  isTodoResult,
  isMetricsResult,
  isTopicsResult,
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
        intentLine: null,
        todos: [],
        activityLog: [],
        suggestions: [],
      };
    }
    return currentAgentMsg!;
  }

  for (const event of events) {
    if (!event.content?.parts) continue;

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
          intentLine: null,
          todos: [],
          activityLog: [],
          suggestions: [],
        });
        continue;
      }

      // --- Tool call ---
      if (part.function_call) {
        if (part.function_call.name === 'transfer_to_agent') continue;
        const msg = ensureAgentMsg(event.timestamp);
        // Activity log: tool entry (will be resolved when result arrives)
        msg.activityLog.push({ kind: 'tool', text: getToolDisplayText(part.function_call.name), toolName: part.function_call.name, resolved: false, ts: event.timestamp ? event.timestamp * 1000 : Date.now() });
        continue;
      }

      // --- Tool result ---
      if (part.function_response) {
        if (part.function_response.name === 'transfer_to_agent') continue;
        const toolName = part.function_response.name;
        const result = (part.function_response.response ?? {}) as Record<string, unknown>;
        const msg = ensureAgentMsg(event.timestamp);

        // Activity log: resolve the tool entry
        for (let i = msg.activityLog.length - 1; i >= 0; i--) {
          if (msg.activityLog[i].kind === 'tool' && msg.activityLog[i].toolName === toolName && !msg.activityLog[i].resolved) {
            msg.activityLog[i] = {
              ...msg.activityLog[i],
              resolved: true,
              error: result?.status === 'error' ? ((result?.message as string) || 'Failed') : undefined,
            };
            break;
          }
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
            data: result.data as unknown[],
            collectionIds: (result.collection_ids as string[] | undefined) ?? undefined,
            filterSql: (result.filter_sql as string | undefined) || undefined,
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
            sourceIds: (state.selected_sources as string[]) || [],
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isReportResult(toolName, result)) {
          msg.cards.push({ type: 'insight_report', data: result });
          artifacts.push({
            id: (result._artifact_id as string) || (result.report_id as string) || `report-restored-${artifacts.length}`,
            type: 'insight_report',
            title: result.title as string,
            collectionIds: (result.collection_ids as string[] | undefined) ?? (result.collection_id ? [result.collection_id as string] : undefined),
            collectionId: result.collection_id as string | undefined,
            dateFrom: result.date_from as string | undefined,
            dateTo: result.date_to as string | undefined,
            cards: result.cards as ReportCard[],
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
        } else if (isStartTaskResult(toolName, result)) {
          // start_task doesn't produce a card — it's an action, not a UI element.
          // Collections were already added to sources during the live session.
        } else if (isTodoResult(toolName, result)) {
          // Populate todos on the message — displayed in ActivityBar
          const todos = (result.todos as Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>) ?? [];
          msg.todos = todos;
          msg.activityLog.push({
            kind: 'todo_update',
            text: (result.progress as string) || `${todos.filter(t => t.status === 'completed').length}/${todos.length}`,
            todos,
            ts: event.timestamp ? event.timestamp * 1000 : Date.now(),
          });
        } else if (isMetricsResult(toolName, result)) {
          msg.cards.push({ type: 'metrics_section', data: result });
        } else if (isTopicsResult(toolName, result)) {
          msg.cards.push({ type: 'topics_section', data: result });
        }
        continue;
      }

      // --- Agent text ---
      if (part.text && event.content.role !== 'user') {
        const msg = ensureAgentMsg(event.timestamp);
        // Extract thinking markers and strip them from visible text
        const thinkingRe = /<!--\s*thinking:\s*([\s\S]*?)\s*-->/g;
        let thinkingMatch;
        while ((thinkingMatch = thinkingRe.exec(part.text)) !== null) {
          const thought = thinkingMatch[1].trim();
          msg.activityLog.push({ kind: 'thinking', text: thought, ts: event.timestamp ? event.timestamp * 1000 : Date.now() });
        }
        // Extract intent markers
        const intentRe = /<!--\s*intent:\s*([\s\S]*?)\s*-->/g;
        let intentMatch;
        while ((intentMatch = intentRe.exec(part.text)) !== null) {
          msg.intentLine = intentMatch[1].trim();
          // Intent shown as pinned header, not in log
        }
        // Strip all HTML comments (status, thinking, plan, etc.) from visible text
        const cleanText = part.text.replace(/<!--[\s\S]*?-->/g, '');
        msg.content += cleanText;
      }
    }
  }

  // Flush any remaining agent message
  flushAgent();

  // Auto-resolve all activity tool entries — we're restoring a completed session,
  // so every tool call has finished.
  for (const msg of messages) {
    for (const entry of msg.activityLog) {
      if (entry.kind === 'tool' && !entry.resolved) {
        entry.resolved = true;
      }
    }
  }

  return {
    messages,
    artifacts,
    selectedSourceIds: (state.selected_sources as string[]) || [],
  };
}
