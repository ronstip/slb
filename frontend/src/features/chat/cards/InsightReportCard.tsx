import { BarChart3, Download, Eye } from 'lucide-react';
import type { ReportCard } from '../../../api/types.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';

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
  const dateRange = formatDateRange(dateFrom, dateTo);

  const handleOpen = () => {
    if (!reportId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(reportId);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {dateRange && <span>{dateRange}</span>}
              {dateRange && cards.length > 0 && <span>·</span>}
              {cards.length > 0 && <span>{cards.length} cards</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpen}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open in Studio"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleOpen}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Download as PDF"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
