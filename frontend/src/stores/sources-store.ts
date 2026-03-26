import { create } from 'zustand';
import type { CollectionConfig, CollectionStatus } from '../api/types.ts';

export interface RunHistoryEntry {
  run_at: string;
  summary: string;
  status: string;
}

export interface Source {
  collectionId: string;
  status: CollectionStatus;
  config: CollectionConfig;
  title: string;
  postsCollected: number;
  totalViews: number;
  positivePct: number | null;
  /** true = card is shown in the panel (in session) */
  selected: boolean;
  /** true = checkbox is checked; collection contributes to agent context */
  active: boolean;
  createdAt: string;
  errorMessage?: string;
  visibility?: 'private' | 'org';
  userId?: string;
  taskId?: string;
<<<<<<< HEAD
  /** Session that started this collection — used to route collection-complete events */
  sessionId?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  totalRuns?: number;
  runHistory?: RunHistoryEntry[];
=======
>>>>>>> c310f0114c3f6908b353aa4001e911ff77d05226
}

interface SourcesStore {
  sources: Source[];
  selectedSourceIds: string[];
  pendingSelectedIds: string[] | null;
  /** Collection IDs autonomously selected by the agent */
  agentSelectedIds: string[];
  /**
   * Pending task/session links for collections not yet in the store.
   * Applied when the collection is first added via setSources.
   */
  pendingLinks: Record<string, { taskId: string; sessionId?: string }>;

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
  /** Update agent-selected collections (from SSE context_update event) */
  setAgentSelectedSources: (ids: string[]) => void;
  /**
   * Store a pending taskId+sessionId for a collection not yet in the store.
   * When the collection syncs in, it will be auto-added to the session with this link.
   */
  setPendingLink: (collectionId: string, taskId: string, sessionId?: string) => void;
  reset: () => void;
}

export const useSourcesStore = create<SourcesStore>((set, get) => ({
  sources: [],
  get selectedSourceIds() {
    return get().sources.filter((s) => s.active).map((s) => s.collectionId);
  },
  pendingSelectedIds: null,
  agentSelectedIds: [],
  pendingLinks: {},

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
      const pendingLinks = s.pendingLinks;
      const hasPendingLinks = Object.keys(pendingLinks).length > 0;

      // Apply pending task/session links to any matching sources (typically newly created collections)
      let processedSources = hasPendingLinks
        ? sources.map((src) => {
            const link = pendingLinks[src.collectionId];
            if (link) {
              return { ...src, taskId: link.taskId, sessionId: link.sessionId, selected: true, active: true };
            }
            return src;
          })
        : sources;

      // Remove applied links; keep only those not yet matched
      const newPendingLinks = hasPendingLinks
        ? Object.fromEntries(
            Object.entries(pendingLinks).filter(
              ([cid]) => !processedSources.some((s) => s.collectionId === cid),
            ),
          )
        : pendingLinks;

      if (pending) {
        processedSources = processedSources.map((src) => ({
          ...src,
          selected: pending.includes(src.collectionId),
          active: pending.includes(src.collectionId),
        }));
        return { sources: processedSources, pendingSelectedIds: null, pendingLinks: newPendingLinks };
      }
      return { sources: processedSources, pendingLinks: newPendingLinks };
    }),

  setAgentSelectedSources: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      return {
        agentSelectedIds: ids,
        sources: s.sources.map((src) => {
          // Agent selections contribute to agent context (active) but don't
          // force the collection into the session panel (selected stays unchanged).
          if (idSet.has(src.collectionId) && !src.active) {
            return { ...src, active: true };
          }
          return src;
        }),
      };
    }),

  setPendingLink: (collectionId, taskId, sessionId) =>
    set((s) => ({
      pendingLinks: { ...s.pendingLinks, [collectionId]: { taskId, sessionId } },
    })),

  reset: () => set({ sources: [], pendingSelectedIds: null, agentSelectedIds: [], pendingLinks: {} }),
}));
