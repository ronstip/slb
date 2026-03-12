import { cn } from '../../lib/utils.ts';

interface ArtifactPreviewIllustrationProps {
  artifactType: string;
  chartType?: string | null;
  /** Tailwind fill color class, e.g. 'fill-emerald-500' */
  fillClass: string;
}

/**
 * Abstract SVG illustrations for artifact library grid cards.
 * Uses simple geometric shapes to suggest the chart/artifact type — no data needed.
 */
export function ArtifactPreviewIllustration({
  artifactType,
  chartType,
  fillClass,
}: ArtifactPreviewIllustrationProps) {
  if (artifactType === 'chart' && chartType) {
    const category = getChartCategory(chartType);
    switch (category) {
      case 'bar':
        return <BarIllustration fillClass={fillClass} />;
      case 'pie':
        return <PieIllustration fillClass={fillClass} />;
      case 'line':
        return <LineIllustration fillClass={fillClass} />;
      case 'table':
        return <TableIllustration fillClass={fillClass} />;
      case 'metrics':
        return <MetricsIllustration fillClass={fillClass} />;
    }
  }

  switch (artifactType) {
    case 'chart':
      return <BarIllustration fillClass={fillClass} />;
    case 'insight_report':
      return <ReportIllustration fillClass={fillClass} />;
    case 'dashboard':
      return <DashboardIllustration fillClass={fillClass} />;
    case 'data_export':
      return <TableIllustration fillClass={fillClass} />;
    default:
      return <BarIllustration fillClass={fillClass} />;
  }
}

type ChartCategory = 'bar' | 'pie' | 'line' | 'table' | 'metrics';

function getChartCategory(chartType: string): ChartCategory {
  if (['sentiment_pie', 'content_type_donut', 'language_pie'].includes(chartType)) return 'pie';
  if (['volume_chart', 'line_chart'].includes(chartType)) return 'line';
  if (['channel_table', 'entity_table'].includes(chartType)) return 'table';
  if (chartType === 'engagement_metrics') return 'metrics';
  return 'bar';
}

function BarIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      <rect x="8" y="28" width="10" height="16" rx="2" className={cn(fillClass, 'opacity-60')} />
      <rect x="22" y="16" width="10" height="28" rx="2" className={cn(fillClass, 'opacity-80')} />
      <rect x="36" y="8" width="10" height="36" rx="2" className={fillClass} />
      <rect x="50" y="20" width="10" height="24" rx="2" className={cn(fillClass, 'opacity-70')} />
      <rect x="64" y="32" width="10" height="12" rx="2" className={cn(fillClass, 'opacity-40')} />
    </svg>
  );
}

function PieIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Full circle background */}
      <circle cx="40" cy="24" r="18" className={cn(fillClass, 'opacity-20')} />
      {/* Segment 1: ~40% */}
      <path d="M40 24 L40 6 A18 18 0 0 1 57.3 15.1 Z" className={fillClass} />
      {/* Segment 2: ~25% */}
      <path d="M40 24 L57.3 15.1 A18 18 0 0 1 55.1 37.7 Z" className={cn(fillClass, 'opacity-70')} />
      {/* Segment 3: ~20% */}
      <path d="M40 24 L55.1 37.7 A18 18 0 0 1 28.2 39.5 Z" className={cn(fillClass, 'opacity-45')} />
    </svg>
  );
}

function LineIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Area under line */}
      <path
        d="M8 38 Q20 30, 28 28 T48 18 T68 22 L72 22 L72 44 L8 44 Z"
        className={cn(fillClass, 'opacity-15')}
      />
      {/* Line */}
      <path
        d="M8 38 Q20 30, 28 28 T48 18 T68 22"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className={cn('stroke-current', fillClass.replace('fill-', 'text-'))}
      />
      {/* Dots */}
      <circle cx="28" cy="28" r="2.5" className={fillClass} />
      <circle cx="48" cy="18" r="2.5" className={fillClass} />
      <circle cx="68" cy="22" r="2.5" className={fillClass} />
    </svg>
  );
}

function TableIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Header row */}
      <rect x="8" y="8" width="64" height="6" rx="2" className={cn(fillClass, 'opacity-50')} />
      {/* Data rows */}
      <rect x="8" y="18" width="48" height="4" rx="1.5" className={cn(fillClass, 'opacity-30')} />
      <rect x="8" y="26" width="56" height="4" rx="1.5" className={cn(fillClass, 'opacity-20')} />
      <rect x="8" y="34" width="38" height="4" rx="1.5" className={cn(fillClass, 'opacity-30')} />
      <rect x="8" y="42" width="52" height="4" rx="1.5" className={cn(fillClass, 'opacity-15')} />
    </svg>
  );
}

function MetricsIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Metric card 1 */}
      <rect x="4" y="6" width="34" height="16" rx="3" className={cn(fillClass, 'opacity-20')} />
      <rect x="8" y="10" width="16" height="3" rx="1" className={cn(fillClass, 'opacity-50')} />
      <rect x="8" y="16" width="10" height="3" rx="1" className={cn(fillClass, 'opacity-30')} />
      {/* Metric card 2 */}
      <rect x="42" y="6" width="34" height="16" rx="3" className={cn(fillClass, 'opacity-20')} />
      <rect x="46" y="10" width="20" height="3" rx="1" className={cn(fillClass, 'opacity-50')} />
      <rect x="46" y="16" width="12" height="3" rx="1" className={cn(fillClass, 'opacity-30')} />
      {/* Metric card 3 */}
      <rect x="4" y="26" width="34" height="16" rx="3" className={cn(fillClass, 'opacity-20')} />
      <rect x="8" y="30" width="14" height="3" rx="1" className={cn(fillClass, 'opacity-50')} />
      <rect x="8" y="36" width="8" height="3" rx="1" className={cn(fillClass, 'opacity-30')} />
      {/* Metric card 4 */}
      <rect x="42" y="26" width="34" height="16" rx="3" className={cn(fillClass, 'opacity-20')} />
      <rect x="46" y="30" width="18" height="3" rx="1" className={cn(fillClass, 'opacity-50')} />
      <rect x="46" y="36" width="10" height="3" rx="1" className={cn(fillClass, 'opacity-30')} />
    </svg>
  );
}

function ReportIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Doc shape */}
      <rect x="18" y="4" width="44" height="40" rx="3" className={cn(fillClass, 'opacity-10')} />
      {/* Title line */}
      <rect x="24" y="10" width="28" height="3.5" rx="1.5" className={cn(fillClass, 'opacity-60')} />
      {/* Text lines */}
      <rect x="24" y="18" width="32" height="2.5" rx="1" className={cn(fillClass, 'opacity-25')} />
      <rect x="24" y="23" width="24" height="2.5" rx="1" className={cn(fillClass, 'opacity-25')} />
      <rect x="24" y="28" width="30" height="2.5" rx="1" className={cn(fillClass, 'opacity-25')} />
      {/* Highlight block */}
      <rect x="24" y="34" width="32" height="6" rx="2" className={cn(fillClass, 'opacity-15')} />
    </svg>
  );
}

function DashboardIllustration({ fillClass }: { fillClass: string }) {
  return (
    <svg viewBox="0 0 80 48" className="h-full w-full" aria-hidden>
      {/* Top-left: mini bar chart */}
      <rect x="4" y="4" width="34" height="18" rx="3" className={cn(fillClass, 'opacity-12')} />
      <rect x="9" y="14" width="5" height="5" rx="1" className={cn(fillClass, 'opacity-50')} />
      <rect x="16" y="10" width="5" height="9" rx="1" className={cn(fillClass, 'opacity-70')} />
      <rect x="23" y="12" width="5" height="7" rx="1" className={cn(fillClass, 'opacity-40')} />
      {/* Top-right: mini donut */}
      <rect x="42" y="4" width="34" height="18" rx="3" className={cn(fillClass, 'opacity-12')} />
      <circle cx="59" cy="13" r="6" className={cn(fillClass, 'opacity-20')} />
      <path d="M59 13 L59 7 A6 6 0 0 1 64.2 10 Z" className={cn(fillClass, 'opacity-60')} />
      {/* Bottom: wide panel */}
      <rect x="4" y="26" width="72" height="18" rx="3" className={cn(fillClass, 'opacity-12')} />
      <rect x="10" y="31" width="20" height="2.5" rx="1" className={cn(fillClass, 'opacity-30')} />
      <rect x="10" y="36" width="14" height="2.5" rx="1" className={cn(fillClass, 'opacity-20')} />
      <rect x="40" y="31" width="16" height="2.5" rx="1" className={cn(fillClass, 'opacity-30')} />
      <rect x="40" y="36" width="24" height="2.5" rx="1" className={cn(fillClass, 'opacity-20')} />
    </svg>
  );
}
