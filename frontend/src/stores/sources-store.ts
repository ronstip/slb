import { create } from 'zustand';
import type { CollectionConfig, CollectionStatus } from '../api/types.ts';

export interface Source {
  collectionId: string;
  status: CollectionStatus;
  config: CollectionConfig;
  title: string;
  postsCollected: number;
  postsEnriched: number;
  postsEmbedded: number;
  selected: boolean;
  createdAt: string;
  errorMessage?: string;
}

interface SourcesStore {
  sources: Source[];
  selectedSourceIds: string[];

  addSource: (source: Source) => void;
  updateSource: (id: string, updates: Partial<Source>) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  removeSource: (id: string) => void;
  setSources: (sources: Source[]) => void;
  reset: () => void;
}

export const useSourcesStore = create<SourcesStore>((set, get) => ({
  sources: [],
  get selectedSourceIds() {
    return get().sources.filter((s) => s.selected).map((s) => s.collectionId);
  },

  addSource: (source) =>
    set((s) => ({ sources: [source, ...s.sources] })),

  updateSource: (id, updates) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, ...updates } : src,
      ),
    })),

  toggleSelected: (id) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, selected: !src.selected } : src,
      ),
    })),

  selectAll: () =>
    set((s) => ({
      sources: s.sources.map((src) => ({ ...src, selected: true })),
    })),

  deselectAll: () =>
    set((s) => ({
      sources: s.sources.map((src) => ({ ...src, selected: false })),
    })),

  removeSource: (id) =>
    set((s) => ({
      sources: s.sources.filter((src) => src.collectionId !== id),
    })),

  setSources: (sources) => set({ sources }),
  reset: () => set({ sources: [] }),
}));
