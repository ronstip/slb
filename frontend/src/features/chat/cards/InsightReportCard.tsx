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

/** Extract the first narrative or key_finding text from report cards as a preview snippet. */
function getPreviewSnippet(cards: ReportCard[]): string | null {
  // Prefer narrative, then key_finding
  for (const type of ['narrative', 'key_finding'] as const) {
    const card = cards.find((c) => c.card_type === type);
    if (card) {
      const text = (card.data as Record<string, unknown>).text as string
        ?? (card.data as Record<string, unknown>).finding as string
        ?? (card.data as Record<string, unknown>).content as string;
      if (text) return text.slice(0, 200);
    }
  }
  return null;
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

  const snippet = getPreviewSnippet(cards);
  const metaParts: string[] = [];
  if (collectionName) metaParts.push(collectionName);
  if (dateRange) metaParts.push(dateRange);
  if (cards.length > 0) metaParts.push(`${cards.length} cards`);
  const meta = metaParts.join(' · ') || 'Insight report';

  // Gather KPI + key finding cards for preview
  const kpiCard = cards.find((c) => c.card_type === 'kpi_grid');
  const keyFindingCards = cards.filter((c) => c.card_type === 'key_finding').slice(0, 2);

  return (
    <div onClick={handleOpen} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-accent-vibrant/20 bg-gradient-to-b from-accent-vibrant/5 to-background shadow-sm transition-colors hover:border-accent-vibrant/40">
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
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-vibrant/10">
            <FileText className="h-4 w-4 text-accent-vibrant" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-[11px] text-muted-foreground">{meta}</p>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          disabled={downloading}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          title="Download PDF"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Preview content */}
      <div className="px-4 pb-3 pt-1 space-y-2">
        {/* KPI preview */}
        {kpiCard && <KpiPreview data={kpiCard.data} />}

        {/* Key findings preview */}
        {keyFindingCards.length > 0 && (
          <div className="space-y-1">
            {keyFindingCards.map((card) => {
              const finding = (card.data as Record<string, unknown>).finding as string
                ?? (card.data as Record<string, unknown>).text as string;
              if (!finding) return null;
              return (
                <div key={card.id} className="flex items-start gap-2 rounded-lg bg-accent-vibrant/5 px-3 py-2">
                  <span className="mt-0.5 text-accent-vibrant text-[10px]">&#9679;</span>
                  <p className="text-xs text-foreground/80 line-clamp-2">{finding}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Narrative snippet fallback */}
        {!kpiCard && keyFindingCards.length === 0 && snippet && (
          <p className="text-xs text-foreground/70 line-clamp-3 leading-relaxed">{snippet}</p>
        )}
      </div>
    </div>
  );
}

/* KPI preview — compact horizontal strip */
function KpiPreview({ data }: { data: Record<string, unknown> }) {
  const kpis = (data.kpis ?? data.items ?? []) as Array<{ label: string; value: string | number; change?: string }>;
  if (kpis.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto">
      {kpis.slice(0, 4).map((kpi, i) => (
        <div key={i} className="flex min-w-0 flex-col rounded-lg border border-border/40 bg-card px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">{kpi.label}</span>
          <span className="text-sm font-semibold text-foreground">{kpi.value}</span>
          {kpi.change && <span className="text-[10px] text-muted-foreground">{kpi.change}</span>}
        </div>
      ))}
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
