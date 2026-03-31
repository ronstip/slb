import { create } from 'zustand';
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
}

export interface ToolCompleteEntry extends ActivityEntryBase {
  kind: 'tool_complete';
  toolName: string;
  text: string;
  durationMs: number;
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
  type: 'research_design' | 'data_export' | 'chart' | 'insight_report' | 'dashboard' | 'collection_progress' | 'structured_prompt' | 'topics_section' | 'metrics_section';
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

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isAgentResponding: false,
  sessionId: null,
  activePromptMessageId: null,
  activePromptData: null,

  setActivePrompt: (id) => set({ activePromptMessageId: id }),
  setActivePromptData: (data) => set({ activePromptData: data }),

  sendUserMessage: (text) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: 'user',
          content: text,
          timestamp: new Date(),
          isStreaming: false,
          cards: [],
          todos: [],
          activityLog: [],
          blocks: [],
        },
      ],
    })),

  startAgentMessage: () => {
    const id = nextId();
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'agent',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          cards: [],
          todos: [],
          activityLog: [],
          blocks: [],
        },
      ],
      isAgentResponding: true,
    }));
    return id;
  },

  appendText: (messageId, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + text } : m,
      ),
    })),

  // Append text to the chronological block stream.
  // If the last block is text, append to it; otherwise create a new text block.
  appendTextBlock: (messageId, text) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const blocks = [...(m.blocks || [])];
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { ...last, content: last.content + text };
        } else {
          blocks.push({ type: 'text', content: text });
        }
        return { ...m, content: m.content + text, blocks };
      }),
    })),

  // Append an activity entry to the chronological block stream.
  // If the last block is activity, push into it; otherwise create a new activity block.
  appendActivityBlock: (messageId, entry) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const blocks = [...(m.blocks || [])];
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'activity') {
          blocks[blocks.length - 1] = { ...last, entries: [...last.entries, entry] };
        } else {
          blocks.push({ type: 'activity', entries: [entry] });
        }
        return { ...m, activityLog: [...m.activityLog, entry], blocks };
      }),
    })),

  setActiveAgent: (messageId, agent) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, activeAgent: agent } : m,
      ),
    })),

  addCard: (messageId, card) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, cards: [...m.cards, card] }
          : m,
      ),
    })),

  appendActivityEntry: (messageId, entry) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, activityLog: [...m.activityLog, entry] }
          : m,
      ),
    })),

  updateTodos: (messageId, newTodos) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
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
        if (changes.length === 0) return { ...m, todos: newTodos };
        // Push todo_change entries into both flat activityLog and chronological blocks
        const blocks = [...(m.blocks || [])];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'activity') {
          blocks[blocks.length - 1] = { ...lastBlock, entries: [...lastBlock.entries, ...changes] };
        } else {
          blocks.push({ type: 'activity', entries: [...changes] });
        }
        return {
          ...m,
          todos: newTodos,
          activityLog: [...m.activityLog, ...changes],
          blocks,
        };
      }),
    })),

  finalizeMessage: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const cleanContent = m.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd();
        // Also clean text blocks and remove empty ones
        const blocks = (m.blocks || [])
          .map((b) => b.type === 'text'
            ? { ...b, content: b.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd() }
            : b
          )
          .filter((b) => b.type !== 'text' || b.content.length > 0);
        return { ...m, isStreaming: false, content: cleanContent, blocks };
      }),
      isAgentResponding: false,
    })),

  addAgentMessage: (text, cards) => {
    const id = nextId();
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'agent' as const,
          content: text,
          timestamp: new Date(),
          isStreaming: false,
          cards: cards ?? [],
          todos: [],
          activityLog: [],
          blocks: text ? [{ type: 'text' as const, content: text }] : [],
        },
      ],
    }));
    return id;
  },

  addSystemMessage: (text, cards) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: 'system',
          content: text,
          timestamp: new Date(),
          isStreaming: false,
          cards: cards ?? [],
          todos: [],
          activityLog: [],
          blocks: [],
        },
      ],
    })),

  updateCard: (messageId, cardIndex, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          cards: m.cards.map((c, i) =>
            i === cardIndex ? { ...c, data: { ...c.data, ...updates } } : c,
          ),
        };
      }),
    })),

  setMessages: (messages) => set({ messages, isAgentResponding: false }),
  setSessionId: (id) => set({ sessionId: id }),
  setIsAgentResponding: (responding) => set({ isAgentResponding: responding }),
  clearMessages: () => set({ messages: [], isAgentResponding: false, activePromptMessageId: null, activePromptData: null }),
  reset: () => set({ messages: [], isAgentResponding: false, sessionId: null, activePromptMessageId: null, activePromptData: null }),
}));
