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

interface UIStore {
  userId: string;
  sourcesPanelCollapsed: boolean;
  studioPanelCollapsed: boolean;
  collectionModalOpen: boolean;
  collectionModalPrefill: CollectionConfig | null;
  activePoll: PollData | null;

  setUserId: (id: string) => void;
  toggleSourcesPanel: () => void;
  toggleStudioPanel: () => void;
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

const loadString = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

export const useUIStore = create<UIStore>((set) => ({
  userId: loadString('slb-user-id', 'default_user'),
  sourcesPanelCollapsed: loadCollapsed('sources-collapsed'),
  studioPanelCollapsed: loadCollapsed('studio-collapsed'),
  collectionModalOpen: false,
  collectionModalPrefill: null,
  activePoll: null,

  setUserId: (id) => {
    localStorage.setItem('slb-user-id', id);
    set({ userId: id });
  },

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
