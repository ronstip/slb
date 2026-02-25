import { useState, useRef } from 'react';
import { BarChart3, Download, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReportCard, ReportCardType } from '../../../api/types.ts';

// Report-specific card components
import { KpiGrid } from './report/KpiGrid.tsx';
import { NarrativeSection } from './report/NarrativeSection.tsx';
import { KeyFindingCard } from './report/KeyFindingCard.tsx';
import { HighlightPostCard } from './report/HighlightPostCard.tsx';

// Existing chart components (reused from studio/charts)
import { SentimentPie } from '../../studio/charts/SentimentPie.tsx';
import { SentimentBar } from '../../studio/charts/SentimentBar.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { LineChart } from '../../studio/charts/LineChart.tsx';
import { Histogram } from '../../studio/charts/Histogram.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { PlatformBar } from '../../studio/charts/PlatformBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../../studio/charts/LanguagePie.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';
import { EntityTable } from '../../studio/charts/EntityTable.tsx';
import { downloadReportPdf } from '../../../lib/download-pdf.ts';

/* ------------------------------------------------------------------ */
/* Card type → component mapping                                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REPORT_CARD_COMPONENTS: Partial<Record<ReportCardType, React.ComponentType<{ data: any }>>> = {
  // Report-specific
  kpi_grid: KpiGrid,
  narrative: NarrativeSection,
  key_finding: KeyFindingCard,
  highlight_post: HighlightPostCard,
  // Chart types — wrap to pass data.data (the chart data array)
  sentiment_pie: ({ data }) => <SentimentPie data={data.data ?? data} />,
  sentiment_bar: ({ data }) => <SentimentBar data={data.data ?? data} />,
  volume_chart: ({ data }) => <VolumeChart data={data.data ?? data} />,
  line_chart: ({ data }) => <LineChart data={data.data ?? data} />,
  histogram: ({ data }) => <Histogram data={data.data ?? data} />,
  theme_bar: ({ data }) => <ThemeBar data={data.data ?? data} />,
  platform_bar: ({ data }) => <PlatformBar data={data.data ?? data} />,
  content_type_donut: ({ data }) => <ContentTypeDonut data={data.data ?? data} />,
  language_pie: ({ data }) => <LanguagePie data={data.data ?? data} />,
  engagement_metrics: ({ data }) => <EngagementMetrics data={data.data ?? data} />,
  channel_table: ({ data }) => <ChannelTable data={data.data ?? data} />,
  entity_table: ({ data }) => <EntityTable data={data.data ?? data} />,
};

/* ------------------------------------------------------------------ */
/* InsightReportCard                                                    */
/* ------------------------------------------------------------------ */

interface InsightReportCardProps {
  data: Record<string, unknown>;
}

function formatDateRange(dateFrom?: string | null, dateTo?: string | null): string | null {
  if (!dateFrom || !dateTo) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(dateFrom)} — ${fmt(dateTo)}`;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h5 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {title}
    </h5>
  );
}

export function InsightReportCard({ data }: InsightReportCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const title = (data.title as string) || 'Insight Report';
  const dateFrom = data.date_from as string | undefined;
  const dateTo = data.date_to as string | undefined;
  const cards = (data.cards ?? []) as ReportCard[];
  const dateRange = formatDateRange(dateFrom, dateTo);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(contentRef.current, title.replace(/\s+/g, '_').toLowerCase());
    } finally {
      setDownloading(false);
    }
  };

  // Group cards by zone
  const headerCards = cards.filter((c) => c.layout?.zone === 'header');
  const bodyCards = cards.filter((c) => !c.layout?.zone || c.layout.zone === 'body');
  const footerCards = cards.filter((c) => c.layout?.zone === 'footer');

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
            <BarChart3 className="h-4 w-4 text-foreground" />
          </div>
          <div className="flex flex-col items-start">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            {dateRange && (
              <span className="text-[11px] text-muted-foreground">{dateRange}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Download as PDF"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && cards.length > 0 && (
        <div ref={contentRef} className="border-t border-border px-5 pb-5">
          {/* Header zone — KPIs */}
          {headerCards.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {headerCards.map((card) => (
                <ReportCardRenderer key={card.id} card={card} />
              ))}
            </div>
          )}

          {/* Body zone — charts, findings, highlights */}
          {bodyCards.length > 0 && (
            <div className="mt-4 flex flex-col gap-4">
              {renderBodyCards(bodyCards)}
            </div>
          )}

          {/* Footer zone — narrative */}
          {footerCards.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {footerCards.map((card) => (
                <ReportCardRenderer key={card.id} card={card} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Body card layout — handles half/full width grids                    */
/* ------------------------------------------------------------------ */

function renderBodyCards(cards: ReportCard[]) {
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < cards.length) {
    const card = cards[i];
    const isHalf = card.layout?.width === 'half';

    if (isHalf) {
      // Look ahead for another half-width card to pair
      const next = cards[i + 1];
      const nextIsHalf = next?.layout?.width === 'half';

      if (nextIsHalf) {
        elements.push(
          <div key={`pair-${card.id}`} className="grid grid-cols-2 gap-4">
            <ReportCardRenderer card={card} />
            <ReportCardRenderer card={next} />
          </div>,
        );
        i += 2;
      } else {
        elements.push(<ReportCardRenderer key={card.id} card={card} />);
        i += 1;
      }
    } else {
      elements.push(<ReportCardRenderer key={card.id} card={card} />);
      i += 1;
    }
  }

  return elements;
}

/* ------------------------------------------------------------------ */
/* Individual card renderer                                            */
/* ------------------------------------------------------------------ */

function ReportCardRenderer({ card }: { card: ReportCard }) {
  const Component = REPORT_CARD_COMPONENTS[card.card_type];
  if (!Component) return null;

  // Chart cards get a bordered container with title
  const isChart = !(
    card.card_type === 'kpi_grid' ||
    card.card_type === 'narrative' ||
    card.card_type === 'key_finding' ||
    card.card_type === 'highlight_post'
  );

  if (isChart) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        {card.title && <SectionTitle title={card.title} />}
        <Component data={card.data} />
      </div>
    );
  }

  return (
    <div>
      {card.title && card.card_type !== 'kpi_grid' && <SectionTitle title={card.title} />}
      <Component data={card.data} />
    </div>
  );
}
