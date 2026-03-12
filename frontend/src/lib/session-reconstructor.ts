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
} from './event-parser.ts';

/** Tools that produce thinking entries (mirrors THINKING_TOOLS in main.py). */
const THINKING_TOOLS = new Set(['execute_sql', 'get_table_info', 'list_table_ids']);

function buildThinkingFromCall(toolName: string, args: Record<string, unknown>): string | null {
  if (!THINKING_TOOLS.has(toolName)) return null;
  if (toolName === 'execute_sql') {
    const query = (args.query ?? args.sql ?? '') as string;
    return query ? `Running SQL query:\n\`\`\`sql\n${query}\n\`\`\`` : 'Running SQL query...';
  }
  if (toolName === 'get_table_info') {
    const table = (args.table_id ?? args.table_name ?? '') as string;
    return `Inspecting schema for \`${table}\``;
  }
  if (toolName === 'list_table_ids') {
    const dataset = (args.dataset_id ?? 'social_listening') as string;
    return `Listing tables in \`${dataset}\``;
  }
  return null;
}

function buildThinkingFromResult(toolName: string): string | null {
  if (!THINKING_TOOLS.has(toolName)) return null;
  if (toolName === 'execute_sql') return 'Query completed';
  return null;
}

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
        toolIndicators: [],
        cards: [],
        thinkingEntries: [],
        statusLine: null,
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
          toolIndicators: [],
          cards: [],
          thinkingEntries: [],
          statusLine: null,
          suggestions: [],
        });
        continue;
      }

      // --- Tool call ---
      if (part.function_call) {
        if (part.function_call.name === 'transfer_to_agent') continue;
        const msg = ensureAgentMsg(event.timestamp);
        msg.toolIndicators.push({
          name: part.function_call.name,
          displayText: getToolDisplayText(part.function_call.name),
          resolved: false,
        });
        // Reconstruct thinking entry from tool call args
        const thinking = buildThinkingFromCall(
          part.function_call.name,
          (part.function_call.args ?? {}) as Record<string, unknown>,
        );
        if (thinking) msg.thinkingEntries.push(thinking);
        continue;
      }

      // --- Tool result ---
      if (part.function_response) {
        if (part.function_response.name === 'transfer_to_agent') continue;
        const toolName = part.function_response.name;
        const result = (part.function_response.response ?? {}) as Record<string, unknown>;
        const msg = ensureAgentMsg(event.timestamp);

        // Resolve the matching tool indicator
        msg.toolIndicators = msg.toolIndicators.map((t) =>
          t.name === toolName && !t.resolved ? { ...t, resolved: true } : t,
        );

        // Reconstruct thinking from tool result
        const thinkResult = buildThinkingFromResult(toolName);
        if (thinkResult) msg.thinkingEntries.push(thinkResult);

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
          msg.thinkingEntries.push(thinkingMatch[1].trim());
        }
        // Strip all HTML comments (status, thinking, plan, etc.) from visible text
        const cleanText = part.text.replace(/<!--[\s\S]*?-->/g, '');
        msg.content += cleanText;
      }
    }
  }

  // Flush any remaining agent message
  flushAgent();

  // Auto-resolve all tool indicators — we're restoring a completed session,
  // so every tool call has finished. This handles cases where the
  // function_response event was dropped during Firestore serialization
  // (e.g. Google Search grounding metadata failing model_dump).
  for (const msg of messages) {
    msg.toolIndicators = msg.toolIndicators.map((t) =>
      t.resolved ? t : { ...t, resolved: true },
    );
  }

  return {
    messages,
    artifacts,
    selectedSourceIds: (state.selected_sources as string[]) || [],
  };
}
