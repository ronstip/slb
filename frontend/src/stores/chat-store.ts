import { create } from 'zustand';
import type { StructuredPromptResult } from '../api/types.ts';

export interface ToolIndicator {
  name: string;
  displayText: string;
  resolved: boolean;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

export interface MessageCard {
  type: 'research_design' | 'data_export' | 'chart' | 'decision' | 'finding' | 'plan' | 'insight_report' | 'dashboard' | 'collection_progress' | 'structured_prompt' | 'topics_section' | 'metrics_section' | 'task_protocol';
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  isStreaming: boolean;
  toolIndicators: ToolIndicator[];
  cards: MessageCard[];
  thinkingEntries: string[];
  statusLine: string | null;
  intentLine: string | null;
  suggestions: string[];
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
  addToolCall: (messageId: string, name: string, displayText: string) => void;
  resolveToolCall: (messageId: string, name: string, result?: Record<string, unknown>) => void;
  removeToolCall: (messageId: string, name: string) => void;
  addCard: (messageId: string, card: MessageCard) => void;
  appendThinking: (messageId: string, content: string) => void;
  setStatusLine: (messageId: string, status: string | null) => void;
  setIntentLine: (messageId: string, intent: string | null) => void;
  setSuggestions: (messageId: string, suggestions: string[]) => void;
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
          toolIndicators: [],
          cards: [],
          thinkingEntries: [],
          statusLine: null,
          intentLine: null,
          suggestions: [],
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
          toolIndicators: [],
          cards: [],
          thinkingEntries: [],
          statusLine: null,
          intentLine: null,
          suggestions: [],
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

  addToolCall: (messageId, name, displayText) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolIndicators: [
                ...m.toolIndicators,
                { name, displayText, resolved: false, startedAt: Date.now() },
              ],
            }
          : m,
      ),
    })),

  resolveToolCall: (messageId, name, result) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        // Resolve only the first unresolved indicator matching the name
        let resolved = false;
        const isError = result?.status === 'error';
        return {
          ...m,
          toolIndicators: m.toolIndicators.map((t) => {
            if (!resolved && t.name === name && !t.resolved) {
              resolved = true;
              return {
                ...t,
                resolved: true,
                durationMs: Date.now() - t.startedAt,
                error: isError ? ((result?.message as string) || 'Tool failed') : undefined,
              };
            }
            return t;
          }),
        };
      }),
    })),

  removeToolCall: (messageId, name) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        // Remove the last unresolved indicator matching the name
        let idx = -1;
        for (let i = m.toolIndicators.length - 1; i >= 0; i--) {
          if (m.toolIndicators[i].name === name && !m.toolIndicators[i].resolved) {
            idx = i;
            break;
          }
        }
        if (idx === -1) return m;
        return {
          ...m,
          toolIndicators: m.toolIndicators.filter((_, i) => i !== idx),
        };
      }),
    })),

  addCard: (messageId, card) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, cards: [...m.cards, card] }
          : m,
      ),
    })),

  appendThinking: (messageId, content) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, thinkingEntries: [...m.thinkingEntries, content] }
          : m,
      ),
    })),

  setStatusLine: (messageId, status) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, statusLine: status } : m,
      ),
    })),

  setIntentLine: (messageId, intent) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, intentLine: intent } : m,
      ),
    })),

  setSuggestions: (messageId, suggestions) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, suggestions }
          : m,
      ),
    })),

  finalizeMessage: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              isStreaming: false,
              statusLine: null,
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
          toolIndicators: [],
          cards: cards ?? [],
          thinkingEntries: [],
          statusLine: null,
          intentLine: null,
          suggestions: [],
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
          toolIndicators: [],
          cards: cards ?? [],
          thinkingEntries: [],
          statusLine: null,
          intentLine: null,
          suggestions: [],
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
