import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { StructuredPromptResult } from '../api/types.ts';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// ── Append-only activity entry types ─────────────────────────────────

export type ActivityEntryKind =
  | 'tool_start'
  | 'tool_complete'
  | 'tool_error'
  | 'tool_blocked'
  | 'thinking'
  | 'todo_change';

interface ActivityEntryBase {
  kind: ActivityEntryKind;
  ts: number;
}

export interface ToolStartEntry extends ActivityEntryBase {
  kind: 'tool_start';
  toolName: string;
  text: string;
  description?: string;
}

export interface ToolCompleteEntry extends ActivityEntryBase {
  kind: 'tool_complete';
  toolName: string;
  text: string;
  durationMs: number;
  description?: string;
}

export interface ToolErrorEntry extends ActivityEntryBase {
  kind: 'tool_error';
  toolName: string;
  text: string;
  error: string;
  durationMs: number;
}

export interface ToolBlockedEntry extends ActivityEntryBase {
  kind: 'tool_blocked';
  toolName: string;
  text: string;
}

export interface ThinkingEntry extends ActivityEntryBase {
  kind: 'thinking';
  text: string;
}

export interface TodoChangeEntry extends ActivityEntryBase {
  kind: 'todo_change';
  todoId: string;
  content: string;
  fromStatus: TodoItem['status'] | null; // null = newly created
  toStatus: TodoItem['status'];
}

export type ActivityEntry =
  | ToolStartEntry
  | ToolCompleteEntry
  | ToolErrorEntry
  | ToolBlockedEntry
  | ThinkingEntry
  | TodoChangeEntry;

export interface MessageCard {
  type: 'research_design' | 'data_export' | 'chart' | 'dashboard' | 'collection_progress' | 'structured_prompt' | 'topics_section' | 'metrics_section';
  data: Record<string, unknown>;
}

// ── Chronological block model ───────────────────────────────────────
// Agent messages are rendered as a sequence of interleaved blocks:
// text → activity → text → activity → ... preserving arrival order.

export type MessageBlock =
  | { type: 'text'; content: string }
  | { type: 'activity'; entries: ActivityEntry[] }

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;              // flat accumulation (kept for compat)
  timestamp: Date;
  isStreaming: boolean;
  cards: MessageCard[];
  todos: TodoItem[];
  activityLog: ActivityEntry[]; // flat accumulation (kept for compat)
  blocks: MessageBlock[];       // chronological interleaved sequence
  activeAgent?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  isAgentResponding: boolean;
  sessionId: string | null;
  activePromptMessageId: string | null;
  activePromptData: StructuredPromptResult | null;

  setActivePrompt: (id: string | null) => void;
  setActivePromptData: (data: StructuredPromptResult | null) => void;
  sendUserMessage: (text: string) => void;
  startAgentMessage: () => string;
  appendText: (messageId: string, text: string) => void;
  appendTextBlock: (messageId: string, text: string) => void;
  appendActivityBlock: (messageId: string, entry: ActivityEntry) => void;
  setActiveAgent: (messageId: string, agent: string) => void;
  addCard: (messageId: string, card: MessageCard) => void;
  appendActivityEntry: (messageId: string, entry: ActivityEntry) => void;
  replaceToolEntry: (messageId: string, toolName: string, entry: ActivityEntry) => void;
  updateTodos: (messageId: string, todos: TodoItem[]) => void;
  finalizeMessage: (messageId: string) => void;
  addAgentMessage: (text: string, cards?: MessageCard[]) => string;
  addSystemMessage: (text: string, cards?: MessageCard[]) => void;
  updateCard: (messageId: string, cardIndex: number, updates: Record<string, unknown>) => void;
  setSessionId: (id: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setIsAgentResponding: (responding: boolean) => void;
  clearMessages: () => void;
  reset: () => void;
}

let messageCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

function emptyMessage(role: ChatMessage['role'], text = '', cards: MessageCard[] = []): ChatMessage {
  return {
    id: nextId(),
    role,
    content: text,
    timestamp: new Date(),
    isStreaming: false,
    cards,
    todos: [],
    activityLog: [],
    blocks: role === 'agent' && text ? [{ type: 'text', content: text }] : [],
  };
}

export const useChatStore = create<ChatStore>()(
  immer((set) => ({
    messages: [],
    isAgentResponding: false,
    sessionId: null,
    activePromptMessageId: null,
    activePromptData: null,

    setActivePrompt: (id) =>
      set((s) => {
        s.activePromptMessageId = id;
      }),
    setActivePromptData: (data) =>
      set((s) => {
        s.activePromptData = data;
      }),

    sendUserMessage: (text) =>
      set((s) => {
        s.messages.push(emptyMessage('user', text));
      }),

    startAgentMessage: () => {
      const msg = emptyMessage('agent');
      msg.isStreaming = true;
      set((s) => {
        s.messages.push(msg);
        s.isAgentResponding = true;
      });
      return msg.id;
    },

    appendText: (messageId, text) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) m.content += text;
      }),

    appendTextBlock: (messageId, text) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (!m) return;
        m.content += text;
        const last = m.blocks[m.blocks.length - 1];
        if (last && last.type === 'text') {
          last.content += text;
        } else {
          m.blocks.push({ type: 'text', content: text });
        }
      }),

    appendActivityBlock: (messageId, entry) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (!m) return;
        m.activityLog.push(entry);
        const last = m.blocks[m.blocks.length - 1];
        if (last && last.type === 'activity') {
          last.entries.push(entry);
        } else {
          m.blocks.push({ type: 'activity', entries: [entry] });
        }
      }),

    setActiveAgent: (messageId, agent) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) m.activeAgent = agent;
      }),

    addCard: (messageId, card) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) m.cards.push(card);
      }),

    appendActivityEntry: (messageId, entry) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) m.activityLog.push(entry);
      }),

    // Replace the last tool_start entry for a given toolName with its completion entry
    // in both activityLog and blocks, so we get one row per tool instead of two.
    replaceToolEntry: (messageId, toolName, entry) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (!m) return;

        for (let i = m.activityLog.length - 1; i >= 0; i--) {
          const e = m.activityLog[i];
          if (e.kind === 'tool_start' && 'toolName' in e && (e as { toolName: string }).toolName === toolName) {
            m.activityLog[i] = entry;
            break;
          }
        }

        for (let bi = m.blocks.length - 1; bi >= 0; bi--) {
          const block = m.blocks[bi];
          if (block.type !== 'activity') continue;
          let replaced = false;
          for (let ei = block.entries.length - 1; ei >= 0; ei--) {
            const e = block.entries[ei];
            if (e.kind === 'tool_start' && 'toolName' in e && (e as { toolName: string }).toolName === toolName) {
              block.entries[ei] = entry;
              replaced = true;
              break;
            }
          }
          if (replaced) break;
        }
      }),

    updateTodos: (messageId, newTodos) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (!m) return;
        const oldMap = new Map(m.todos.map((t) => [t.id, t]));
        const changes: ActivityEntry[] = [];
        const now = Date.now();
        for (const t of newTodos) {
          const old = oldMap.get(t.id);
          if (!old) {
            changes.push({ kind: 'todo_change', ts: now, todoId: t.id, content: t.content, fromStatus: null, toStatus: t.status });
          } else if (old.status !== t.status) {
            changes.push({ kind: 'todo_change', ts: now, todoId: t.id, content: t.content, fromStatus: old.status, toStatus: t.status });
          }
        }
        m.todos = newTodos;
        if (changes.length === 0) return;
        m.activityLog.push(...changes);
        const last = m.blocks[m.blocks.length - 1];
        if (last && last.type === 'activity') {
          last.entries.push(...changes);
        } else {
          m.blocks.push({ type: 'activity', entries: [...changes] });
        }
      }),

    finalizeMessage: (messageId) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (m) {
          m.isStreaming = false;
          m.content = m.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd();
          // Strip HTML comments from text blocks and drop emptied ones
          m.blocks = m.blocks
            .map((b) =>
              b.type === 'text'
                ? { type: 'text' as const, content: b.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd() }
                : b,
            )
            .filter((b) => b.type !== 'text' || b.content.length > 0);
        }
        s.isAgentResponding = false;
      }),

    addAgentMessage: (text, cards) => {
      const msg = emptyMessage('agent', text, cards ?? []);
      set((s) => {
        s.messages.push(msg);
      });
      return msg.id;
    },

    addSystemMessage: (text, cards) =>
      set((s) => {
        s.messages.push(emptyMessage('system', text, cards ?? []));
      }),

    updateCard: (messageId, cardIndex, updates) =>
      set((s) => {
        const m = s.messages.find((x) => x.id === messageId);
        if (!m) return;
        const card = m.cards[cardIndex];
        if (!card) return;
        card.data = { ...card.data, ...updates };
      }),

    setMessages: (messages) =>
      set((s) => {
        s.messages = messages;
        s.isAgentResponding = false;
      }),
    setSessionId: (id) =>
      set((s) => {
        s.sessionId = id;
      }),
    setIsAgentResponding: (responding) =>
      set((s) => {
        s.isAgentResponding = responding;
      }),
    clearMessages: () =>
      set((s) => {
        s.messages = [];
        s.isAgentResponding = false;
        s.activePromptMessageId = null;
        s.activePromptData = null;
      }),
    reset: () =>
      set((s) => {
        s.messages = [];
        s.isAgentResponding = false;
        s.sessionId = null;
        s.activePromptMessageId = null;
        s.activePromptData = null;
      }),
  })),
);
