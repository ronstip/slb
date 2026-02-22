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
  /** true = card is shown in the panel (in session) */
  selected: boolean;
  /** true = checkbox is checked; collection contributes to agent context */
  active: boolean;
  createdAt: string;
  errorMessage?: string;
  visibility?: 'private' | 'org';
  userId?: string;
}

interface SourcesStore {
  sources: Source[];
  selectedSourceIds: string[];
  pendingSelectedIds: string[] | null;

  addSource: (source: Source) => void;
  updateSource: (id: string, updates: Partial<Source>) => void;
  /** Add to session panel and activate (checkbox on) */
  addToSession: (id: string) => void;
  /** Remove from session panel entirely */
  removeFromSession: (id: string) => void;
  /** Toggle active (checkbox) without affecting session membership */
  toggleActive: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  removeSource: (id: string) => void;
  selectByIds: (ids: string[]) => void;
  setSources: (sources: Source[]) => void;
  reset: () => void;
}

export const useSourcesStore = create<SourcesStore>((set, get) => ({
  sources: [],
  get selectedSourceIds() {
    return get().sources.filter((s) => s.selected).map((s) => s.collectionId);
  },
  pendingSelectedIds: null,

  addSource: (source) =>
    set((s) => ({ sources: [source, ...s.sources] })),

  updateSource: (id, updates) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, ...updates } : src,
      ),
    })),

  addToSession: (id) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, selected: true, active: true } : src,
      ),
    })),

  removeFromSession: (id) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, selected: false, active: false } : src,
      ),
    })),

  toggleActive: (id) =>
    set((s) => ({
      sources: s.sources.map((src) =>
        src.collectionId === id ? { ...src, active: !src.active } : src,
      ),
    })),

  selectAll: () =>
    set((s) => ({
      sources: s.sources.map((src) => ({ ...src, selected: true, active: true })),
    })),

  deselectAll: () =>
    set((s) => ({
      sources: s.sources.map((src) => ({ ...src, selected: false, active: false })),
      pendingSelectedIds: null,
    })),

  removeSource: (id) =>
    set((s) => ({
      sources: s.sources.filter((src) => src.collectionId !== id),
    })),

  selectByIds: (ids) =>
    set((s) => {
      if (s.sources.length === 0) {
        return { pendingSelectedIds: ids };
      }
      return {
        pendingSelectedIds: null,
        sources: s.sources.map((src) => ({
          ...src,
          selected: ids.includes(src.collectionId),
          active: ids.includes(src.collectionId),
        })),
      };
    }),

  setSources: (sources) =>
    set((s) => {
      const pending = s.pendingSelectedIds;
      if (pending) {
        return {
          sources: sources.map((src) => ({
            ...src,
            selected: pending.includes(src.collectionId),
            active: pending.includes(src.collectionId),
          })),
          pendingSelectedIds: null,
        };
      }
      return { sources };
    }),

  reset: () => set({ sources: [], pendingSelectedIds: null }),
}));
