import { FileText, Table2, ChevronRight } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { shortDate } from '../../lib/format.ts';
import { InsightReport } from './InsightReport.tsx';
import { DataExportView } from './DataExportView.tsx';
import { Card } from '../../components/ui/card.tsx';

export function ArtifactsTab() {
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandedReportId = useStudioStore((s) => s.expandedReportId);
  const expandReport = useStudioStore((s) => s.expandReport);

  // Show expanded artifact if one is selected
  const expandedArtifact = artifacts.find((a) => a.id === expandedReportId);
  if (expandedArtifact) {
    if (expandedArtifact.type === 'data_export') {
      return <DataExportView artifact={expandedArtifact as Extract<Artifact, { type: 'data_export' }>} />;
    }
    return <InsightReport artifact={expandedArtifact as Extract<Artifact, { type: 'insight_report' }>} />;
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-muted-foreground">
          Generate insights to create your first artifact.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {artifacts.map((artifact) => (
        <Card
          key={artifact.id}
          className="cursor-pointer p-3 transition-colors hover:border-primary/30"
          onClick={() => expandReport(artifact.id)}
        >
          <div className="flex items-center gap-3">
            {artifact.type === 'data_export'
              ? <Table2 className="h-5 w-5 shrink-0 text-muted-foreground" />
              : <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {artifact.title}
              </p>
              <p className="text-xs text-muted-foreground/70">
                {shortDate(artifact.createdAt)} · {artifact.type === 'data_export'
                  ? `${artifact.rowCount} posts`
                  : `${artifact.sourceIds.length} sources`}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          </div>
        </Card>
      ))}
    </div>
  );
}
