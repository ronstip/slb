import { Table2, BarChart3, Presentation, FileText } from 'lucide-react';
import type { ArtifactDetail } from '../../api/endpoints/artifacts.ts';
import type { Artifact, ChartStyleOverrides } from '../../stores/studio-store.ts';

export const ARTIFACT_STYLES: Record<string, {
  icon: typeof Table2;
  color: string;
  bg: string;
  fill: string;
  gradientFrom: string;
  label: string;
}> = {
  data_export: { icon: Table2, color: 'text-blue-500', bg: 'bg-blue-500/10', fill: 'fill-blue-500', gradientFrom: 'from-blue-500/12', label: 'Data Export' },
  chart: { icon: BarChart3, color: 'text-emerald-500', bg: 'bg-emerald-500/10', fill: 'fill-emerald-500', gradientFrom: 'from-emerald-500/12', label: 'Chart' },
  presentation: { icon: Presentation, color: 'text-orange-500', bg: 'bg-orange-500/10', fill: 'fill-orange-500', gradientFrom: 'from-orange-500/12', label: 'Presentation' },
  markdown: { icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10', fill: 'fill-violet-500', gradientFrom: 'from-violet-500/12', label: 'Report' },
};

export function convertToStudioArtifact(detail: ArtifactDetail): Artifact | null {
  const base = {
    id: detail.artifact_id,
    title: detail.title,
    createdAt: new Date(detail.created_at),
  };
  const p = detail.payload;

  switch (detail.type) {
    case 'chart':
      return {
        ...base,
        type: 'chart',
        chartType: p.chart_type as string,
        data: (p.data ?? {}) as Record<string, unknown>,
        barOrientation: p.bar_orientation as string | undefined,
        stacked: p.stacked as boolean | undefined,
        styleOverrides: p.style_overrides as ChartStyleOverrides | undefined,
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
    case 'presentation':
      return {
        ...base,
        type: 'presentation',
        collectionIds: detail.collection_ids,
        slideCount: (p.slide_count ?? 0) as number,
      } as Extract<Artifact, { type: 'presentation' }>;
    case 'markdown':
      return {
        ...base,
        type: 'markdown',
        content: (p.content ?? '') as string,
        summary: (p.summary ?? undefined) as string | undefined,
        collectionIds: detail.collection_ids,
        sourceSql: (p.source_sql ?? undefined) as string | undefined,
      } as Extract<Artifact, { type: 'markdown' }>;
    case 'dashboard':
      return null;
  }
}
