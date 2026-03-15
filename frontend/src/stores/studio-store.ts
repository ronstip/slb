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
  data: unknown[];
  colorOverrides?: Record<string, string>;
  collectionIds?: string[];
  filterSql?: string;
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

export type StudioTab = 'feed' | 'artifacts';
export type Artifact = DataExportArtifact | ChartArtifact | InsightReportArtifact | DashboardArtifact;

interface StudioStore {
  activeTab: StudioTab;
  artifacts: Artifact[];
  expandedReportId: string | null;
  feedSourceId: string | null;

  setActiveTab: (tab: StudioTab) => void;
  addArtifact: (artifact: Artifact) => void;
  loadExternalArtifact: (artifact: Artifact) => void;
  expandReport: (id: string) => void;
  collapseReport: () => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  updateArtifactTitle: (id: string, title: string) => void;
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
  reset: () => set({ activeTab: 'feed', artifacts: [], expandedReportId: null, feedSourceId: null }),
}));
