/**
 * Reconstructs frontend UI state (chat messages, artifacts) from raw ADK
 * events stored in Firestore. This mirrors the logic in useSSEChat.ts but
 * operates on the persisted event format instead of live SSE events.
 */

import type { ChatMessage, MessageCard } from '../stores/chat-store.ts';
import type { Artifact } from '../stores/studio-store.ts';
import type { InsightData, DataExportRow } from '../api/types.ts';
import type { RawADKEvent } from '../api/endpoints/sessions.ts';
import {
  getToolDisplayText,
  isDesignResearchResult,
  isInsightResult,
  isProgressResult,
  isDataExportResult,
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
        toolIndicators: [],
        cards: [],
      };
    }
    return currentAgentMsg;
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

        // Create cards + artifacts (mirrors useSSEChat logic)
        if (isDesignResearchResult(toolName, result)) {
          msg.cards.push({ type: 'research_design', data: result });
        } else if (isInsightResult(toolName, result)) {
          msg.cards.push({ type: 'insight_summary', data: result });
          artifacts.push({
            id: `artifact-restored-${artifacts.length}`,
            type: 'insight_report',
            title: 'Insight Report',
            narrative: result.narrative as string,
            data: result.data as InsightData,
            sourceIds: (state.selected_sources as string[]) || [],
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isDataExportResult(toolName, result)) {
          msg.cards.push({ type: 'data_export', data: result });
          artifacts.push({
            id: `artifact-restored-${artifacts.length}`,
            type: 'data_export',
            title: 'Data Export',
            rows: result.rows as DataExportRow[],
            rowCount: result.row_count as number,
            columnNames: result.column_names as string[],
            sourceIds: (state.selected_sources as string[]) || [],
            createdAt: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
          });
        } else if (isProgressResult(toolName, result)) {
          msg.cards.push({ type: 'progress', data: result });
        }
        continue;
      }

      // --- Agent text ---
      if (part.text && event.content.role !== 'user') {
        const msg = ensureAgentMsg(event.timestamp);
        msg.content += part.text;
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
