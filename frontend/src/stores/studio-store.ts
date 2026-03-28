import { create } from 'zustand';
import type { DataExportRow, ReportCard } from '../api/types.ts';

interface DataExportArtifact {
  id: string;
  type: 'data_export';
  title: string;
  rows: DataExportRow[];
  rowCount: number;
  columnNames: string[];
  sourceIds: string[];
  createdAt: Date;
}

interface ChartArtifact {
  id: string;
  type: 'chart';
  title: string;
  chartType: string;
  data: Record<string, unknown>;
  barOrientation?: string;
  collectionIds?: string[];
  sourceSql?: string;
  createdAt: Date;
}

interface InsightReportArtifact {
  id: string;
  type: 'insight_report';
  title: string;
  collectionIds?: string[];
  /** @deprecated Use collectionIds */
  collectionId?: string;
  dateFrom?: string;
  dateTo?: string;
  cards: ReportCard[];
  createdAt: Date;
}

interface DashboardArtifact {
  id: string;
  type: 'dashboard';
  title: string;
  collectionIds: string[];
  collectionNames: Record<string, string>;
  createdAt: Date;
}

export type StudioTab = 'feed' | 'artifacts' | 'protocol';
export type Artifact = DataExportArtifact | ChartArtifact | InsightReportArtifact | DashboardArtifact;

export interface PendingTopicFilter {
  themes: string[];
  topicName: string;
}

interface StudioStore {
  activeTab: StudioTab;
  artifacts: Artifact[];
  expandedReportId: string | null;
  feedSourceId: string | null;
  pendingTopicFilter: PendingTopicFilter | null;
  protocolContent: string | null;

  setActiveTab: (tab: StudioTab) => void;
  addArtifact: (artifact: Artifact) => void;
  loadExternalArtifact: (artifact: Artifact) => void;
  expandReport: (id: string) => void;
  collapseReport: () => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  updateArtifactTitle: (id: string, title: string) => void;
  setFeedSource: (id: string | null) => void;
  setPendingTopicFilter: (filter: PendingTopicFilter) => void;
  clearPendingTopicFilter: () => void;
  setProtocolContent: (content: string | null) => void;
  reset: () => void;
}

export const useStudioStore = create<StudioStore>((set) => ({
  activeTab: 'feed',
  artifacts: [],
  expandedReportId: null,
  feedSourceId: null,
  pendingTopicFilter: null,
  protocolContent: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  addArtifact: (artifact) =>
    set((s) => ({ artifacts: [artifact, ...s.artifacts] })),

  loadExternalArtifact: (artifact) =>
    set((s) => {
      if (s.artifacts.some((a) => a.id === artifact.id)) return s;
      return { artifacts: [artifact, ...s.artifacts] };
    }),

  setArtifacts: (artifacts) => set({ artifacts }),
  updateArtifactTitle: (id, title) =>
    set((s) => ({
      artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, title } : a)),
    })),
  expandReport: (id) => set({ expandedReportId: id }),
  collapseReport: () => set({ expandedReportId: null }),
  setFeedSource: (id) => set({ feedSourceId: id }),
  setPendingTopicFilter: (filter) => set({ pendingTopicFilter: filter }),
  clearPendingTopicFilter: () => set({ pendingTopicFilter: null }),
  setProtocolContent: (content) => set({ protocolContent: content }),
  reset: () => set({ activeTab: 'feed', artifacts: [], expandedReportId: null, feedSourceId: null, pendingTopicFilter: null, protocolContent: null }),
}));
