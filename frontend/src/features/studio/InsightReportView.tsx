import { useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Table2 } from 'lucide-react';
import { useStudioStore } from '../../stores/studio-store.ts';
import type { Artifact } from '../../stores/studio-store.ts';
import type { ReportCard, ReportCardType } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { downloadReportPdf } from '../../lib/download-pdf.ts';
import { UnderlyingDataDialog } from './UnderlyingDataDialog.tsx';

// Report sub-components
import { KpiGrid } from '../chat/cards/report/KpiGrid.tsx';
import { NarrativeSection } from '../chat/cards/report/NarrativeSection.tsx';
import { KeyFindingCard } from '../chat/cards/report/KeyFindingCard.tsx';
import { TopPostsTable } from '../chat/cards/report/TopPostsTable.tsx';

// Chart components — unified on SocialChartWidget (Chart.js)
import { SocialChartWidget } from './dashboard/SocialChartWidget.tsx';
import type { SocialChartType, WidgetData } from './dashboard/types-social-dashboard.ts';
import { formatNumber } from '../../lib/format.ts';

/** Normalize snake_case → camelCase for WidgetData. */
function toWidgetData(raw: Record<string, unknown>): WidgetData {
  return {
    labels: raw.labels as string[] | undefined,
    values: raw.values as number[] | undefined,
    value: raw.value as number | undefined,
    timeSeries: (raw.timeSeries ?? raw.time_series) as WidgetData['timeSeries'],
    groupedTimeSeries: (raw.groupedTimeSeries ?? raw.grouped_time_series) as WidgetData['groupedTimeSeries'],
  };
}

/** Generic chart types rendered by SocialChartWidget. */
const CHARTJS_TYPES = new Set(['bar', 'line', 'pie', 'doughnut']);

/** Report table card (columns + rows). */
function ReportTable({ data }: { data: Record<string, unknown> }) {
  const columns = (data.columns ?? []) as string[];
  const rows = (data.rows ?? []) as unknown[][];
  if (!columns.length || !rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/20 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 text-foreground">
                  {typeof cell === 'number' ? formatNumber(cell) : String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REPORT_CARD_COMPONENTS: Partial<Record<ReportCardType, React.ComponentType<{ data: any }>>> = {
  kpi_grid: KpiGrid,
  narrative: NarrativeSection,
  key_finding: KeyFindingCard,
  top_posts_table: TopPostsTable,
};

type InsightReportArtifact = Extract<Artifact, { type: 'insight_report' }>;

interface InsightReportViewProps {
  artifact: InsightReportArtifact;
}

function formatDateRange(dateFrom?: string, dateTo?: string): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
}

export function InsightReportView({ artifact }: InsightReportViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [downloading, setDownloading] = useState(false);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const dateRange = formatDateRange(artifact.dateFrom, artifact.dateTo);

  const handleDownload = async () => {
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(contentRef.current, artifact.title.replace(/\s+/g, '_').toLowerCase());
    } finally {
      setDownloading(false);
    }
  };

  const headerCards = artifact.cards.filter((c) => c.layout?.zone === 'header');
  const bodyCards = artifact.cards.filter((c) => !c.layout?.zone || c.layout.zone === 'body');
  const footerCards = artifact.cards.filter((c) => c.layout?.zone === 'footer');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={collapseReport}
          className="h-auto gap-1.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </Button>
        <div className="flex items-center gap-1.5">
          {(artifact.collectionIds?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnderlyingData(true)}
              className="h-auto gap-1.5 px-2.5 py-1 text-xs"
            >
              <Table2 className="h-3.5 w-3.5" />
              Data
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="h-auto gap-1.5 px-2.5 py-1 text-xs"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {downloading ? 'Exporting...' : 'Download PDF'}
          </Button>
        </div>
      </div>

      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <h3 className="text-base font-semibold text-foreground">{artifact.title}</h3>
        {dateRange && (
          <p className="mt-0.5 text-xs text-muted-foreground">{dateRange}</p>
        )}

        {/* Header zone */}
        {headerCards.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {headerCards.map((card) => (
              <CardRenderer key={card.id} card={card} />
            ))}
          </div>
        )}

        {/* Body zone */}
        {bodyCards.length > 0 && (
          <div className="mt-4 flex flex-col gap-4">
            {bodyCards.map((card) => (
              <CardRenderer key={card.id} card={card} />
            ))}
          </div>
        )}

        {/* Footer zone */}
        {footerCards.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {footerCards.map((card) => (
              <CardRenderer key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}

function CardRenderer({ card }: { card: ReportCard }) {
  // Non-chart components (kpi_grid, narrative, key_finding, top_posts_table)
  const Component = REPORT_CARD_COMPONENTS[card.card_type];
  if (Component) return <Component data={card.data} />;

  // Generic chart types → SocialChartWidget
  if (CHARTJS_TYPES.has(card.card_type)) {
    const widgetData = toWidgetData(card.data as Record<string, unknown>);
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        {card.title && (
          <h5 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.title}
          </h5>
        )}
        <div className="h-[280px]">
          <SocialChartWidget
            chartType={card.card_type as SocialChartType}
            data={widgetData}
          />
        </div>
      </div>
    );
  }

  // Table type
  if (card.card_type === 'table') {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        {card.title && (
          <h5 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.title}
          </h5>
        )}
        <ReportTable data={card.data as Record<string, unknown>} />
      </div>
    );
  }

  // Number type
  if (card.card_type === 'number') {
    const numData = card.data as Record<string, unknown>;
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center">
        {card.title && (
          <h5 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.title}
          </h5>
        )}
        <span className="text-3xl font-bold text-foreground">
          {formatNumber((numData.value as number) ?? 0)}
        </span>
        {typeof numData.label === 'string' && numData.label && (
          <p className="mt-1 text-xs text-muted-foreground">{numData.label}</p>
        )}
      </div>
    );
  }

  return null;
}
