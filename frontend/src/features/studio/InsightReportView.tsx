import { useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useStudioStore } from '../../stores/studio-store.ts';
import type { Artifact } from '../../stores/studio-store.ts';
import type { ReportCard, ReportCardType } from '../../api/types.ts';
import { Button } from '../../components/ui/button.tsx';
import { downloadReportPdf } from '../../lib/download-pdf.ts';

// Report sub-components
import { KpiGrid } from '../chat/cards/report/KpiGrid.tsx';
import { NarrativeSection } from '../chat/cards/report/NarrativeSection.tsx';
import { KeyFindingCard } from '../chat/cards/report/KeyFindingCard.tsx';
import { TopPostsTable } from '../chat/cards/report/TopPostsTable.tsx';

// Chart components
import { SentimentPie } from './charts/SentimentPie.tsx';
import { SentimentBar } from './charts/SentimentBar.tsx';
import { VolumeChart } from './charts/VolumeChart.tsx';
import { LineChart } from './charts/LineChart.tsx';
import { Histogram } from './charts/Histogram.tsx';
import { ThemeBar } from './charts/ThemeBar.tsx';
import { PlatformBar } from './charts/PlatformBar.tsx';
import { ContentTypeDonut } from './charts/ContentTypeDonut.tsx';
import { LanguagePie } from './charts/LanguagePie.tsx';
import { EngagementMetrics } from './charts/EngagementMetrics.tsx';
import { ChannelTable } from './charts/ChannelTable.tsx';
import { EntityTable } from './charts/EntityTable.tsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REPORT_CARD_COMPONENTS: Partial<Record<ReportCardType, React.ComponentType<{ data: any }>>> = {
  kpi_grid: KpiGrid,
  narrative: NarrativeSection,
  key_finding: KeyFindingCard,
  top_posts_table: TopPostsTable,
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
    </div>
  );
}

function CardRenderer({ card }: { card: ReportCard }) {
  const Component = REPORT_CARD_COMPONENTS[card.card_type];
  if (!Component) return null;

  const isChart = !(
    card.card_type === 'kpi_grid' ||
    card.card_type === 'narrative' ||
    card.card_type === 'key_finding' ||
    card.card_type === 'top_posts_table'
  );

  if (isChart) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        {card.title && (
          <h5 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.title}
          </h5>
        )}
        <Component data={card.data} />
      </div>
    );
  }

  return <Component data={card.data} />;
}
