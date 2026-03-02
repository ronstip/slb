import { create } from 'zustand';
import type { CollectionConfig } from '../api/types.ts';

interface PollOption {
  label: string;
  value: string;
}

export interface PollData {
  question: string;
  options: PollOption[];
  type: 'single' | 'multi' | 'confirm';
}

export type LayoutMode = 'balanced' | 'studio-focus';

interface UIStore {
  sourcesPanelCollapsed: boolean;
  studioPanelCollapsed: boolean;
  layoutMode: LayoutMode;
  collectionModalOpen: boolean;
  collectionModalPrefill: CollectionConfig | null;
  activePoll: PollData | null;

  toggleSourcesPanel: () => void;
  toggleStudioPanel: () => void;
  expandStudioPanel: () => void;
  setStudioFocus: () => void;
  openCollectionModal: (prefill?: CollectionConfig) => void;
  closeCollectionModal: () => void;
  showPoll: (poll: PollData) => void;
  dismissPoll: () => void;
}

const loadCollapsed = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
};

export const useUIStore = create<UIStore>((set) => ({
  sourcesPanelCollapsed: loadCollapsed('sources-collapsed'),
  studioPanelCollapsed: loadCollapsed('studio-collapsed'),
  layoutMode: 'balanced' as LayoutMode,
  collectionModalOpen: false,
  collectionModalPrefill: null,
  activePoll: null,

  toggleSourcesPanel: () =>
    set((s) => {
      const next = !s.sourcesPanelCollapsed;
      localStorage.setItem('sources-collapsed', String(next));
      return { sourcesPanelCollapsed: next };
    }),

  toggleStudioPanel: () =>
    set((s) => {
      const next = !s.studioPanelCollapsed;
      localStorage.setItem('studio-collapsed', String(next));
      return { studioPanelCollapsed: next };
    }),

  expandStudioPanel: () =>
    set((s) => {
      if (s.studioPanelCollapsed) {
        localStorage.setItem('studio-collapsed', 'false');
        return { studioPanelCollapsed: false };
      }
      return s;
    }),

  setStudioFocus: () =>
    set(() => {
      localStorage.setItem('sources-collapsed', 'true');
      return {
        layoutMode: 'studio-focus' as LayoutMode,
        sourcesPanelCollapsed: true,
      };
    }),

  openCollectionModal: (prefill) =>
    set({
      collectionModalOpen: true,
      collectionModalPrefill: prefill ?? null,
    }),

  closeCollectionModal: () =>
    set({ collectionModalOpen: false, collectionModalPrefill: null }),

  showPoll: (poll) => set({ activePoll: poll }),
  dismissPoll: () => set({ activePoll: null }),
}));
