import { useRef, useState, useCallback } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import type { ReportCard } from '../../../api/types.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';

// Report sub-components used for the off-screen PDF render
import { KpiGrid } from './report/KpiGrid.tsx';
import { NarrativeSection } from './report/NarrativeSection.tsx';
import { KeyFindingCard } from './report/KeyFindingCard.tsx';

interface InsightReportCardProps {
  data: Record<string, unknown>;
}

function formatDateRange(dateFrom?: string | null, dateTo?: string | null): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
}

export function InsightReportCard({ data }: InsightReportCardProps) {
  const title = (data.title as string) || 'Insight Report';
  const reportId = data.report_id as string | undefined;
  const dateFrom = data.date_from as string | undefined;
  const dateTo = data.date_to as string | undefined;
  const cards = (data.cards ?? []) as ReportCard[];
  const collectionName = data.collection_name as string | undefined;
  const dateRange = formatDateRange(dateFrom, dateTo);

  const [downloading, setDownloading] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    if (!reportId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(reportId);
  }, [reportId]);

  const handleDownload = useCallback(async () => {
    if (!pdfRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(pdfRef.current, title.replace(/\s+/g, '_').toLowerCase());
    } finally {
      setDownloading(false);
    }
  }, [title, downloading]);

  const metaParts: string[] = [];
  if (collectionName) metaParts.push(collectionName);
  if (dateRange) metaParts.push(dateRange);
  if (cards.length > 0) metaParts.push(`${cards.length} cards`);
  const meta = metaParts.join(' · ') || 'Insight report';

  return (
    <div onClick={handleOpen} className="cursor-pointer overflow-hidden rounded-2xl border border-accent-vibrant/20 bg-gradient-to-b from-accent-vibrant/5 to-background shadow-sm transition-colors hover:border-accent-vibrant/40">
      {/* Off-screen render for PDF export */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0, width: '700px', pointerEvents: 'none' }}>
        <div ref={pdfRef} style={{ padding: '24px', background: 'white' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>{title}</h2>
          {dateRange && <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>{dateRange}</p>}
          {cards.map((card) => {
            const Comp = PDF_CARD_COMPONENTS[card.card_type];
            if (!Comp) return null;
            return <div key={card.id} style={{ marginBottom: '12px' }}><Comp data={card.data} /></div>;
          })}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-vibrant/10">
            <FileText className="h-4 w-4 text-accent-vibrant" />
          </div>
          <div className="flex flex-col min-w-0">
            <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
            <p className="text-[11px] text-muted-foreground truncate">{meta}</p>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          disabled={downloading}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          title="Download PDF"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// Minimal card renderers for PDF export
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDF_CARD_COMPONENTS: Partial<Record<string, React.ComponentType<{ data: any }>>> = {
  kpi_grid: KpiGrid,
  narrative: NarrativeSection,
  key_finding: KeyFindingCard,
};
