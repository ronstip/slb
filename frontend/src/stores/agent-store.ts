import { create } from 'zustand';
import type { Agent, AgentStatus } from '../api/endpoints/agents.ts';
import {
  listAgents,
  getAgent as fetchAgent,
  updateAgent as patchAgent,
} from '../api/endpoints/agents.ts';
import { useSourcesStore } from './sources-store.ts';

interface AgentStore {
  agents: Agent[];
  activeAgentId: string | null;
  activeAgent: Agent | null;
  isLoading: boolean;
  error: string | null;

  fetchAgents: () => Promise<void>;
  setActiveAgent: (id: string | null, collectionIds?: string[]) => void;
  loadAgent: (id: string) => Promise<Agent | null>;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  updateAgentStatus: (id: string, status: AgentStatus) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  activeAgentId: null,
  activeAgent: null,
  isLoading: false,
  error: null,

  fetchAgents: async () => {
    const { agents: prev, isLoading: alreadyLoading } = get();
    if (prev.length === 0 && !alreadyLoading) {
      set({ isLoading: true, error: null });
    }
    try {
      const agents = await listAgents();
      const { activeAgentId } = get();
      const activeAgent = activeAgentId
        ? agents.find((t) => t.agent_id === activeAgentId) ?? null
        : null;
      set({ agents, activeAgent, isLoading: false, error: null });
    } catch {
      set({ isLoading: false, error: 'Failed to load agents. Please try again.' });
    }
  },

  setActiveAgent: (id: string | null, collectionIds?: string[]) => {
    const agent = id ? get().agents.find((t) => t.agent_id === id) ?? null : null;
    set({ activeAgentId: id, activeAgent: agent });
    const ids = collectionIds ?? agent?.collection_ids ?? [];
    useSourcesStore.getState().selectByIds(ids);
  },

  loadAgent: async (id: string) => {
    try {
      const agent = await fetchAgent(id);
      set((s) => {
        const exists = s.agents.some((t) => t.agent_id === id);
        const agents = exists
          ? s.agents.map((t) => (t.agent_id === id ? agent : t))
          : [...s.agents, agent];
        return {
          agents,
          activeAgent: s.activeAgentId === id ? agent : s.activeAgent,
        };
      });
      return agent;
    } catch {
      return null;
    }
  },

  updateAgent: (id: string, updates: Partial<Agent>) => {
    set((s) => ({
      agents: s.agents.map((t) =>
        t.agent_id === id ? { ...t, ...updates } : t,
      ),
      activeAgent:
        s.activeAgentId === id && s.activeAgent
          ? { ...s.activeAgent, ...updates }
          : s.activeAgent,
    }));
  },

  updateAgentStatus: (id: string, status: AgentStatus) => {
    get().updateAgent(id, { status });
    patchAgent(id, { status }).catch(() => {});
  },

  reset: () => {
    set({
      agents: [],
      activeAgentId: null,
      activeAgent: null,
      isLoading: false,
      error: null,
    });
  },
}));
