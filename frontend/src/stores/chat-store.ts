import { create } from 'zustand';

export interface ToolIndicator {
  name: string;
  displayText: string;
  resolved: boolean;
}

export interface MessageCard {
  type: 'research_design' | 'progress' | 'insight_summary';
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
}

interface ChatStore {
  messages: ChatMessage[];
  isAgentResponding: boolean;
  sessionId: string | null;

  sendUserMessage: (text: string) => void;
  startAgentMessage: () => string;
  appendText: (messageId: string, text: string) => void;
  addToolCall: (messageId: string, name: string, displayText: string) => void;
  resolveToolCall: (messageId: string, name: string, result?: Record<string, unknown>) => void;
  addCard: (messageId: string, card: MessageCard) => void;
  finalizeMessage: (messageId: string) => void;
  addSystemMessage: (text: string) => void;
  setSessionId: (id: string) => void;
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

  finalizeMessage: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, isStreaming: false } : m,
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
        },
      ],
    })),

  setSessionId: (id) => set({ sessionId: id }),
  setIsAgentResponding: (responding) => set({ isAgentResponding: responding }),
  clearMessages: () => set({ messages: [], isAgentResponding: false }),
  reset: () => set({ messages: [], isAgentResponding: false, sessionId: null }),
}));
