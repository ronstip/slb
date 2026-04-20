import { useState, useCallback } from 'react';
import { BarChart3, Table2, LayoutDashboard, Download, Loader2 } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { formatNumber } from '../../../lib/format.ts';

// ── Type config ──────────────────────────────────────────────────────

type ArtifactType = 'chart' | 'data_export' | 'dashboard';

const TYPE_CONFIG: Record<ArtifactType, {
  Icon: typeof BarChart3;
  border: string;
  bg: string;
  hoverBorder: string;
  iconBg: string;
  iconColor: string;
}> = {
  chart: {
    Icon: BarChart3,
    border: 'border-accent-success/20',
    bg: 'from-accent-success/5',
    hoverBorder: 'hover:border-accent-success/40',
    iconBg: 'bg-accent-success/10',
    iconColor: 'text-accent-success',
  },
  data_export: {
    Icon: Table2,
    border: 'border-accent-blue/20',
    bg: 'from-accent-blue/5',
    hoverBorder: 'hover:border-accent-blue/40',
    iconBg: 'bg-accent-blue/10',
    iconColor: 'text-accent-blue',
  },
  dashboard: {
    Icon: LayoutDashboard,
    border: 'border-amber-500/20',
    bg: 'from-amber-500/5',
    hoverBorder: 'hover:border-amber-500/40',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
  },
};

const CHART_TYPE_LABELS: Record<string, string> = {
  bar: 'Bar chart',
  line: 'Line chart',
  pie: 'Pie chart',
  doughnut: 'Donut chart',
  table: 'Table',
  number: 'KPI',
};

// ── Helpers ──────────────────────────────────────────────────────────

function deriveTitle(type: ArtifactType, data: Record<string, unknown>): string {
  return (data.title as string) || {
    chart: 'Chart',
    data_export: 'Data Export',
    dashboard: 'Interactive Dashboard',
  }[type];
}

function deriveMeta(type: ArtifactType, data: Record<string, unknown>): string {
  switch (type) {
    case 'chart': {
      const chartType = data.chart_type as string;
      return (data.collection_name as string) || CHART_TYPE_LABELS[chartType] || chartType?.replace(/_/g, ' ') || '';
    }
    case 'data_export': {
      const count = data.row_count as number;
      const name = data.collection_name as string;
      return name ? `${formatNumber(count)} posts from ${name}` : `${formatNumber(count)} posts`;
    }
    case 'dashboard': {
      const names = Object.values((data.collection_names ?? {}) as Record<string, string>);
      const parts: string[] = [];
      if (names.length > 0) {
        parts.push(names.length <= 2 ? names.join(' & ') : `${names.length} collections`);
      } else {
        const ids = (data.collection_ids ?? []) as string[];
        if (ids.length > 0) parts.push(`${ids.length} collection${ids.length !== 1 ? 's' : ''}`);
      }
      parts.push('Interactive filters');
      return parts.join(' · ');
    }
  }
}

function getArtifactId(type: ArtifactType, data: Record<string, unknown>): string | undefined {
  return (data._artifactId as string)
    || (data._artifact_id as string)
    || (type === 'dashboard' ? data.dashboard_id as string : undefined);
}

// ── Component ────────────────────────────────────────────────────────

interface ArtifactCardProps {
  type: ArtifactType;
  data: Record<string, unknown>;
}

export function ArtifactCard({ type, data }: ArtifactCardProps) {
  const config = TYPE_CONFIG[type];
  const title = deriveTitle(type, data);
  const meta = deriveMeta(type, data);
  const artifactId = getArtifactId(type, data);
  const [downloading, setDownloading] = useState(false);

  const handleOpen = useCallback(() => {
    if (!artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(artifactId);
  }, [artifactId]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      if (type === 'data_export') {
        const collectionId = data.collection_id as string;
        if (collectionId) await downloadCollection(collectionId, 'Data Export');
      }
    } finally {
      setDownloading(false);
    }
  }, [type, data, downloading]);

  const hasDownload = type === 'data_export' && !!data.collection_id;

  if (type === 'data_export' && (data.row_count as number) === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{data.message as string}</p>
      </div>
    );
  }

  return (
    <div onClick={handleOpen} className={`cursor-pointer overflow-hidden rounded-2xl border ${config.border} bg-gradient-to-b ${config.bg} to-background shadow-sm transition-colors ${config.hoverBorder}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${config.iconBg}`}>
            <config.Icon className={`h-4 w-4 ${config.iconColor}`} />
          </div>
          <div className="flex flex-col min-w-0">
            <h4 className="font-heading text-sm font-semibold tracking-tight text-foreground truncate">{title}</h4>
            <p className="text-[11px] text-muted-foreground truncate">{meta}</p>
          </div>
        </div>
        {hasDownload && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            title="Download CSV"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
