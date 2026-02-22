import { create } from 'zustand';

export interface ToolIndicator {
  name: string;
  displayText: string;
  resolved: boolean;
}

export interface MessageCard {
  type: 'research_design' | 'progress' | 'insight_summary' | 'data_export' | 'chart' | 'post_embed';
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
  suggestions: string[];
  activeAgent?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  isAgentResponding: boolean;
  sessionId: string | null;

  sendUserMessage: (text: string) => void;
  startAgentMessage: () => string;
  appendText: (messageId: string, text: string) => void;
  setActiveAgent: (messageId: string, agent: string) => void;
  addToolCall: (messageId: string, name: string, displayText: string) => void;
  resolveToolCall: (messageId: string, name: string, result?: Record<string, unknown>) => void;
  addCard: (messageId: string, card: MessageCard) => void;
  appendThinking: (messageId: string, content: string) => void;
  setSuggestions: (messageId: string, suggestions: string[]) => void;
  finalizeMessage: (messageId: string) => void;
  addSystemMessage: (text: string) => void;
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
                { name, displayText, resolved: false },
              ],
            }
          : m,
      ),
    })),

  resolveToolCall: (messageId, name, _result) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolIndicators: m.toolIndicators.map((t) =>
                t.name === name ? { ...t, resolved: true } : t,
              ),
            }
          : m,
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

  appendThinking: (messageId, content) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, thinkingEntries: [...m.thinkingEntries, content] }
          : m,
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
              content: m.content.replace(/<!--[\s\S]*?-->/g, '').trimEnd(),
            }
          : m,
      ),
      isAgentResponding: false,
    })),

  addSystemMessage: (text) =>
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
          cards: [],
          thinkingEntries: [],
          suggestions: [],
        },
      ],
    })),

  setMessages: (messages) => set({ messages, isAgentResponding: false }),
  setSessionId: (id) => set({ sessionId: id }),
  setIsAgentResponding: (responding) => set({ isAgentResponding: responding }),
  clearMessages: () => set({ messages: [], isAgentResponding: false }),
  reset: () => set({ messages: [], isAgentResponding: false, sessionId: null }),
}));
