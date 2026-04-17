import { useState } from 'react';
import { Table2, BarChart3, FileText, LayoutDashboard, MoreHorizontal, Presentation, Download } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { shortDate } from '../../lib/format.ts';
import { DataExportView } from './DataExportView.tsx';
import { InsightReportView } from './InsightReportView.tsx';
import { ChartArtifactView } from './ChartArtifactView.tsx';
import { DashboardView } from './dashboard/DashboardView.tsx';
import { UnderlyingDataDialog } from './UnderlyingDataDialog.tsx';
import { cn } from '../../lib/utils.ts';
import { Button } from '../../components/ui/button.tsx';
import { apiGetBlob } from '../../api/client.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';

const ARTIFACT_STYLES: Record<string, { icon: typeof Table2; color: string; bg: string }> = {
  data_export: { icon: Table2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  insight_report: { icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  chart: { icon: BarChart3, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  dashboard: { icon: LayoutDashboard, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  presentation: { icon: Presentation, color: 'text-orange-500', bg: 'bg-orange-500/10' },
};

function getArtifactCollectionIds(artifact: Artifact): string[] {
  if (artifact.type === 'data_export') return artifact.sourceIds;
  if (artifact.type === 'insight_report') return artifact.collectionIds ?? [];
  if (artifact.type === 'dashboard') return artifact.collectionIds;
  if (artifact.type === 'chart') return artifact.collectionIds ?? [];
  if (artifact.type === 'presentation') return artifact.collectionIds;
  return [];
}

async function downloadPresentation(id: string, title: string) {
  try {
    const blob = await apiGetBlob(`/presentations/${id}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_').slice(0, 60)}.pptx`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Delay revoke so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('Failed to download presentation:', err);
  }
}

export function ArtifactsTab() {
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandedReportId = useStudioStore((s) => s.expandedReportId);
  const expandReport = useStudioStore((s) => s.expandReport);
  const [underlyingDataArtifactId, setUnderlyingDataArtifactId] = useState<string | null>(null);

  // Show expanded artifact if one is selected
  const expandedArtifact = artifacts.find((a) => a.id === expandedReportId);
  if (expandedArtifact) {
    if (expandedArtifact.type === 'data_export') {
      return <DataExportView artifact={expandedArtifact as Extract<Artifact, { type: 'data_export' }>} />;
    }
    if (expandedArtifact.type === 'insight_report') {
      return <InsightReportView artifact={expandedArtifact as Extract<Artifact, { type: 'insight_report' }>} />;
    }
    if (expandedArtifact.type === 'chart') {
      return <ChartArtifactView artifact={expandedArtifact as Extract<Artifact, { type: 'chart' }>} />;
    }
    if (expandedArtifact.type === 'dashboard') {
      return <DashboardView artifact={expandedArtifact as Extract<Artifact, { type: 'dashboard' }>} />;
    }
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="rounded-full bg-muted p-3">
          <FileText className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          No artifacts yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Reports, charts, and exports will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-3">
        {artifacts.map((artifact) => {
          const style = ARTIFACT_STYLES[artifact.type] ?? ARTIFACT_STYLES.chart;
          const Icon = style.icon;
          const collectionIds = getArtifactCollectionIds(artifact);

          const isPresentation = artifact.type === 'presentation';

          const subtitleText = artifact.type === 'data_export'
            ? `${artifact.rowCount} posts`
            : artifact.type === 'insight_report'
              ? `${artifact.cards.length} cards`
              : artifact.type === 'dashboard'
                ? `${artifact.collectionIds.length} collection${artifact.collectionIds.length !== 1 ? 's' : ''}`
                : artifact.type === 'presentation'
                  ? `${artifact.slideCount} slide${artifact.slideCount !== 1 ? 's' : ''}`
                  : artifact.chartType.replace(/_/g, ' ');

          return (
            <div
              key={artifact.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/20 hover:shadow-md"
              onClick={() => isPresentation ? downloadPresentation(artifact.id, artifact.title) : expandReport(artifact.id)}
            >
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', style.bg)}>
                <Icon className={cn('h-4 w-4', style.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {artifact.title}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {shortDate(artifact.createdAt)} · {subtitleText}
                </p>
              </div>
              {isPresentation ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); downloadPresentation(artifact.id, artifact.title); }}
                  title="Download presentation"
                >
                  <Download className="h-4 w-4" />
                </Button>
              ) : collectionIds.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setUnderlyingDataArtifactId(artifact.id)}>
                      <Table2 className="mr-2 h-3.5 w-3.5" />
                      Show underlying data
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        })}
      </div>
      <UnderlyingDataDialog
        artifactId={underlyingDataArtifactId}
        onClose={() => setUnderlyingDataArtifactId(null)}
      />
    </>
  );
}
