/**
 * Reconstructs frontend UI state (chat messages, artifacts) from raw ADK
 * events stored in Firestore. Replays persisted events through the shared
 * event-mapper so live and reconstructed sessions agree on state.
 *
 * Side effects (nav, studio panel, sources updates, query invalidation) do
 * not happen here — those are live-only and handled by useSSEChat. On
 * reload, the current backend state is fetched fresh by dedicated hooks.
 */

import type { ChatMessage, ToolStartEntry } from '../stores/chat-store.ts';
import type { Artifact } from '../stores/studio-store.ts';
import type { RawADKEvent } from '../api/endpoints/sessions.ts';
import {
  mapToolCall,
  mapToolResult,
  type MapperContext,
} from './event-mapper.ts';

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
  const dataExportSourceIds = (state.agent_selected_sources as string[]) || [];
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

  function buildCtx(ts: number): MapperContext {
    // Fallback IDs embed artifacts.length so they're stable and unique across
    // a replay run. createdAt uses the event timestamp, not Date.now(), so a
    // replay renders the real chronology.
    const i = artifacts.length;
    return {
      now: ts,
      fallbackId: (kind) => {
        switch (kind) {
          case 'data_export': return `artifact-restored-${i}`;
          case 'presentation': return `ppt-restored-${i}`;
          default: return `${kind}-restored-${i}`;
        }
      },
      dataExportSourceIds,
    };
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
        const entry = mapToolCall(
          part.function_call.name,
          (part.function_call.args ?? {}) as Record<string, unknown>,
          buildCtx(ts),
        );
        if (entry) msg.activityLog.push(entry);
        continue;
      }

      // --- Tool result ---
      if (part.function_response) {
        if (part.function_response.name === 'transfer_to_agent') continue;
        const toolName = part.function_response.name;
        const result = (part.function_response.response ?? {}) as Record<string, unknown>;
        const msg = ensureAgentMsg(event.timestamp);
        const ts = event.timestamp ? event.timestamp * 1000 : Date.now();

        const startEntry = [...msg.activityLog].reverse().find(
          (e) => e.kind === 'tool_start' && e.toolName === toolName,
        ) as ToolStartEntry | undefined;
        const durationMs = startEntry ? ts - startEntry.ts : 0;
        const prevDescription = startEntry?.description;

        const patch = mapToolResult(toolName, result, prevDescription, msg.todos, durationMs, buildCtx(ts));
        if (patch.activityEntry) msg.activityLog.push(patch.activityEntry);
        if (patch.cards.length) msg.cards.push(...patch.cards);
        if (patch.artifacts.length) artifacts.push(...patch.artifacts);
        if (patch.todoUpdate) {
          msg.activityLog.push(...patch.todoUpdate.changes);
          msg.todos = patch.todoUpdate.newTodos;
        }
        continue;
      }

      // --- Agent text ---
      if (part.text && event.content.role !== 'user' && !part.thought) {
        const msg = ensureAgentMsg(event.timestamp);
        msg.content += part.text.replace(/<!--[\s\S]*?-->/g, '');
      }
    }
  }

  flushAgent();

  return {
    messages,
    artifacts,
    selectedSourceIds: (state.agent_selected_sources as string[]) || [],
  };
}
