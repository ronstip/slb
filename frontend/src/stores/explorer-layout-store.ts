import { create } from 'zustand';
import type { ExplorerLayoutListItem } from '../api/endpoints/explorer-layouts.ts';
import {
  listExplorerLayouts,
  createExplorerLayout,
  deleteExplorerLayout,
} from '../api/endpoints/explorer-layouts.ts';
import { apiPost } from '../api/client.ts';
import { getNewLayoutStarterWidgets } from '../features/studio/dashboard/defaults-social-dashboard.ts';
import { useSocialDashboardStore } from '../features/studio/dashboard/social-dashboard-store.ts';

interface ExplorerLayoutStore {
  agentLayouts: ExplorerLayoutListItem[];
  activeLayoutId: string | null;
  isLoadingLayouts: boolean;
  /** When true, the explorer tab should open in edit mode (reset after use) */
  startInEditMode: boolean;

  fetchAgentLayouts: (agentId: string) => Promise<void>;
  selectLayout: (layoutId: string | null) => void;
  createLayout: (agentId: string, title: string) => Promise<string>;
  removeLayout: (layoutId: string) => Promise<void>;
  clearStartInEditMode: () => void;
  reset: () => void;
}

export const useExplorerLayoutStore = create<ExplorerLayoutStore>((set, get) => ({
  agentLayouts: [],
  activeLayoutId: null,
  isLoadingLayouts: false,
  startInEditMode: false,

  fetchAgentLayouts: async (agentId: string) => {
    set({ isLoadingLayouts: true });
    try {
      const agentLayouts = await listExplorerLayouts(agentId);
      set({ agentLayouts, isLoadingLayouts: false });
    } catch {
      set({ isLoadingLayouts: false });
    }
  },

  selectLayout: (layoutId: string | null) => {
    useSocialDashboardStore.getState().setEditMode(false);
    set({ activeLayoutId: layoutId, startInEditMode: false });
  },

  createLayout: async (agentId: string, title: string) => {
    const result = await createExplorerLayout({ agent_id: agentId, title });
    // Seed widget data BEFORE setting activeLayoutId to avoid race condition
    await apiPost(`/dashboard/layouts/${result.layout_id}`, {
      layout: getNewLayoutStarterWidgets(),
    });
    // Now safe to switch — DashboardView will find the seeded layout
    set((s) => ({
      agentLayouts: [result, ...s.agentLayouts],
      activeLayoutId: result.layout_id,
      startInEditMode: true,
    }));
    return result.layout_id;
  },

  removeLayout: async (layoutId: string) => {
    await deleteExplorerLayout(layoutId);
    set((s) => ({
      agentLayouts: s.agentLayouts.filter((l) => l.layout_id !== layoutId),
      activeLayoutId: s.activeLayoutId === layoutId ? null : s.activeLayoutId,
      startInEditMode: false,
    }));
  },

  clearStartInEditMode: () => set({ startInEditMode: false }),

  reset: () =>
    set({
      agentLayouts: [],
      activeLayoutId: null,
      isLoadingLayouts: false,
      startInEditMode: false,
    }),
}));
