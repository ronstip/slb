import { useRef, useState, useCallback } from 'react';
import { BarChart3, FileText, Table2, LayoutDashboard, Download, Loader2 } from 'lucide-react';
import type { ReportCard } from '../../../api/types.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { formatNumber } from '../../../lib/format.ts';

// Report sub-components for off-screen PDF render
import { KpiGrid } from './report/KpiGrid.tsx';
import { NarrativeSection } from './report/NarrativeSection.tsx';
import { KeyFindingCard } from './report/KeyFindingCard.tsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDF_CARD_COMPONENTS: Partial<Record<string, React.ComponentType<{ data: any }>>> = {
  kpi_grid: KpiGrid,
  narrative: NarrativeSection,
  key_finding: KeyFindingCard,
};

// ── Type config ──────────────────────────────────────────────────────

type ArtifactType = 'chart' | 'insight_report' | 'data_export' | 'dashboard';

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
  insight_report: {
    Icon: FileText,
    border: 'border-accent-vibrant/20',
    bg: 'from-accent-vibrant/5',
    hoverBorder: 'hover:border-accent-vibrant/40',
    iconBg: 'bg-accent-vibrant/10',
    iconColor: 'text-accent-vibrant',
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

function formatDateRange(dateFrom?: string | null, dateTo?: string | null): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
}

function deriveTitle(type: ArtifactType, data: Record<string, unknown>): string {
  return (data.title as string) || {
    chart: 'Chart',
    insight_report: 'Insight Report',
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
    case 'insight_report': {
      const parts: string[] = [];
      if (data.collection_name) parts.push(data.collection_name as string);
      const dateRange = formatDateRange(data.date_from as string, data.date_to as string);
      if (dateRange) parts.push(dateRange);
      const cards = (data.cards ?? []) as unknown[];
      if (cards.length > 0) parts.push(`${cards.length} cards`);
      return parts.join(' · ') || 'Insight report';
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
    || (type === 'insight_report' ? data.report_id as string : undefined)
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
  const pdfRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    if (!artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(artifactId);
  }, [artifactId]);

  // Download handlers per type
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      if (type === 'insight_report' && pdfRef.current) {
        await downloadReportPdf(pdfRef.current, title.replace(/\s+/g, '_').toLowerCase());
      } else if (type === 'data_export') {
        const collectionId = data.collection_id as string;
        if (collectionId) await downloadCollection(collectionId, 'Data Export');
      }
    } finally {
      setDownloading(false);
    }
  }, [type, data, title, downloading]);

  const hasDownload = type === 'insight_report' || (type === 'data_export' && !!data.collection_id);

  // Empty data export
  if (type === 'data_export' && (data.row_count as number) === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{data.message as string}</p>
      </div>
    );
  }

  return (
    <div onClick={handleOpen} className={`cursor-pointer overflow-hidden rounded-2xl border ${config.border} bg-gradient-to-b ${config.bg} to-background shadow-sm transition-colors ${config.hoverBorder}`}>
      {/* Off-screen PDF render (insight_report only) */}
      {type === 'insight_report' && (
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0, width: '700px', pointerEvents: 'none' }}>
          <div ref={pdfRef} style={{ padding: '24px', background: 'white' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>{title}</h2>
            {(() => {
              const dateRange = formatDateRange(data.date_from as string, data.date_to as string);
              return dateRange ? <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>{dateRange}</p> : null;
            })()}
            {((data.cards ?? []) as ReportCard[]).map((card) => {
              const Comp = PDF_CARD_COMPONENTS[card.card_type];
              if (!Comp) return null;
              return <div key={card.id} style={{ marginBottom: '12px' }}><Comp data={card.data} /></div>;
            })}
          </div>
        </div>
      )}

      {/* Card content */}
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
            title={type === 'insight_report' ? 'Download PDF' : 'Download CSV'}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
