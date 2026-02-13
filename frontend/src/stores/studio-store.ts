import { create } from 'zustand';
import type { InsightData } from '../api/types.ts';

export interface Artifact {
  id: string;
  type: 'insight_report';
  title: string;
  narrative: string;
  data: InsightData;
  sourceIds: string[];
  createdAt: Date;
}

interface StudioStore {
  activeTab: 'feed' | 'artifacts';
  artifacts: Artifact[];
  expandedReportId: string | null;
  feedSourceId: string | null;

  setActiveTab: (tab: 'feed' | 'artifacts') => void;
  addArtifact: (artifact: Artifact) => void;
  expandReport: (id: string) => void;
  collapseReport: () => void;
  setFeedSource: (id: string | null) => void;
  reset: () => void;
}

export const useStudioStore = create<StudioStore>((set) => ({
  activeTab: 'feed',
  artifacts: [],
  expandedReportId: null,
  feedSourceId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  addArtifact: (artifact) =>
    set((s) => ({ artifacts: [artifact, ...s.artifacts] })),

  expandReport: (id) => set({ expandedReportId: id }),
  collapseReport: () => set({ expandedReportId: null }),
  setFeedSource: (id) => set({ feedSourceId: id }),
  reset: () => set({ activeTab: 'feed', artifacts: [], expandedReportId: null, feedSourceId: null }),
}));
