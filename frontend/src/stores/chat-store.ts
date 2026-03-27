import { create } from 'zustand';
import type { StructuredPromptResult } from '../api/types.ts';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type ActivityEntryKind = 'tool' | 'thinking' | 'todo_update';

export interface ActivityEntry {
  kind: ActivityEntryKind;
  text: string;
  ts: number;
  // Tool-specific
  toolName?: string;
  resolved?: boolean;
  durationMs?: number;
  error?: string;
  // Todo-specific
  todos?: TodoItem[];
}

export interface MessageCard {
  type: 'research_design' | 'data_export' | 'chart' | 'insight_report' | 'dashboard' | 'collection_progress' | 'structured_prompt' | 'topics_section' | 'metrics_section';
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  isStreaming: boolean;
  cards: MessageCard[];
  todos: TodoItem[];
  activityLog: ActivityEntry[];
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
  setActiveAgent: (messageId: string, agent: string) => void;
  addCard: (messageId: string, card: MessageCard) => void;
  appendActivityEntry: (messageId: string, entry: ActivityEntry) => void;
  resolveActivityTool: (messageId: string, toolName: string, error?: string) => void;
  removeActivityTool: (messageId: string, toolName: string) => void;
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

  resolveActivityTool: (messageId, toolName, error) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        let found = false;
        const log = [...m.activityLog];
        for (let i = log.length - 1; i >= 0; i--) {
          if (log[i].kind === 'tool' && log[i].toolName === toolName && !log[i].resolved) {
            log[i] = { ...log[i], resolved: true, durationMs: Date.now() - log[i].ts, error };
            found = true;
            break;
          }
        }
        return found ? { ...m, activityLog: log } : m;
      }),
    })),

  removeActivityTool: (messageId, toolName) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        let idx = -1;
        for (let i = m.activityLog.length - 1; i >= 0; i--) {
          if (m.activityLog[i].kind === 'tool' && m.activityLog[i].toolName === toolName && !m.activityLog[i].resolved) {
            idx = i;
            break;
          }
        }
        if (idx === -1) return m;
        return { ...m, activityLog: m.activityLog.filter((_, i) => i !== idx) };
      }),
    })),

  updateTodos: (messageId, todos) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, todos } : m,
      ),
    })),

  finalizeMessage: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              isStreaming: false,
              content: m.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd(),
            }
          : m,
      ),
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
