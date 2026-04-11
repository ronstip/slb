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
  collectionsLibraryOpen: boolean;
  artifactLibraryOpen: boolean;
  activePoll: PollData | null;
  signUpPromptOpen: boolean;

  toggleSourcesPanel: () => void;
  toggleStudioPanel: () => void;
  expandStudioPanel: () => void;
  setStudioFocus: () => void;
  openCollectionModal: (prefill?: CollectionConfig) => void;
  closeCollectionModal: () => void;
  openCollectionsLibrary: () => void;
  closeCollectionsLibrary: () => void;
  openArtifactLibrary: () => void;
  closeArtifactLibrary: () => void;
  showPoll: (poll: PollData) => void;
  dismissPoll: () => void;
  openSignUpPrompt: () => void;
  closeSignUpPrompt: () => void;
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
  collectionsLibraryOpen: false,
  artifactLibraryOpen: false,
  activePoll: null,
  signUpPromptOpen: false,

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

  openCollectionsLibrary: () => set({ collectionsLibraryOpen: true }),
  closeCollectionsLibrary: () => set({ collectionsLibraryOpen: false }),

  openArtifactLibrary: () => set({ artifactLibraryOpen: true }),
  closeArtifactLibrary: () => set({ artifactLibraryOpen: false }),

  showPoll: (poll) => set({ activePoll: poll }),
  dismissPoll: () => set({ activePoll: null }),
  openSignUpPrompt: () => set({ signUpPromptOpen: true }),
  closeSignUpPrompt: () => set({ signUpPromptOpen: false }),
}));
