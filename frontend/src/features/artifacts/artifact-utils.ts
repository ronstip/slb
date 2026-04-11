import { Table2, BarChart3, FileText, LayoutDashboard, Presentation } from 'lucide-react';
import type { ArtifactDetail } from '../../api/endpoints/artifacts.ts';
import type { Artifact } from '../../stores/studio-store.ts';

export const ARTIFACT_STYLES: Record<string, {
  icon: typeof Table2;
  color: string;
  bg: string;
  fill: string;
  gradientFrom: string;
  label: string;
}> = {
  data_export: { icon: Table2, color: 'text-blue-500', bg: 'bg-blue-500/10', fill: 'fill-blue-500', gradientFrom: 'from-blue-500/12', label: 'Data Export' },
  insight_report: { icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10', fill: 'fill-violet-500', gradientFrom: 'from-violet-500/12', label: 'Report' },
  chart: { icon: BarChart3, color: 'text-emerald-500', bg: 'bg-emerald-500/10', fill: 'fill-emerald-500', gradientFrom: 'from-emerald-500/12', label: 'Chart' },
  dashboard: { icon: LayoutDashboard, color: 'text-amber-500', bg: 'bg-amber-500/10', fill: 'fill-amber-500', gradientFrom: 'from-amber-500/12', label: 'Dashboard' },
  presentation: { icon: Presentation, color: 'text-orange-500', bg: 'bg-orange-500/10', fill: 'fill-orange-500', gradientFrom: 'from-orange-500/12', label: 'Presentation' },
};

export function convertToStudioArtifact(detail: ArtifactDetail): Artifact {
  const base = {
    id: detail.artifact_id,
    title: detail.title,
    createdAt: new Date(detail.created_at),
  };
  const p = detail.payload;

  switch (detail.type) {
    case 'insight_report':
      return {
        ...base,
        type: 'insight_report',
        cards: (p.cards ?? []) as Artifact extends { type: 'insight_report' } ? Artifact['cards'] : never,
        collectionIds: detail.collection_ids,
        dateFrom: p.date_from as string | undefined,
        dateTo: p.date_to as string | undefined,
      } as Extract<Artifact, { type: 'insight_report' }>;
    case 'chart':
      return {
        ...base,
        type: 'chart',
        chartType: p.chart_type as string,
        data: (p.data ?? {}) as Record<string, unknown>,
        colorOverrides: p.color_overrides as Record<string, string> | undefined,
        collectionIds: detail.collection_ids,
      } as Extract<Artifact, { type: 'chart' }>;
    case 'data_export':
      return {
        ...base,
        type: 'data_export',
        rows: (p.rows ?? []) as Extract<Artifact, { type: 'data_export' }>['rows'],
        rowCount: (p.row_count ?? 0) as number,
        columnNames: (p.column_names ?? []) as string[],
        sourceIds: detail.collection_ids,
      } as Extract<Artifact, { type: 'data_export' }>;
    case 'dashboard':
      return {
        ...base,
        type: 'dashboard',
        collectionIds: detail.collection_ids,
        collectionNames: (p.collection_names ?? {}) as Record<string, string>,
      } as Extract<Artifact, { type: 'dashboard' }>;
    case 'presentation':
      return {
        ...base,
        type: 'presentation',
        collectionIds: detail.collection_ids,
        slideCount: (p.slide_count ?? 0) as number,
      } as Extract<Artifact, { type: 'presentation' }>;
  }
}
