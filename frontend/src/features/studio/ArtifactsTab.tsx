import { FileText, ChevronRight } from 'lucide-react';
import { useStudioStore } from '../../stores/studio-store.ts';
import { shortDate } from '../../lib/format.ts';
import { InsightReport } from './InsightReport.tsx';

export function ArtifactsTab() {
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandedReportId = useStudioStore((s) => s.expandedReportId);
  const expandReport = useStudioStore((s) => s.expandReport);

  // Show expanded report if one is selected
  const expandedArtifact = artifacts.find((a) => a.id === expandedReportId);
  if (expandedArtifact) {
    return <InsightReport artifact={expandedArtifact} />;
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-text-secondary">
          Generate insights to create your first artifact.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          onClick={() => expandReport(artifact.id)}
          className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-surface p-3 text-left transition-colors hover:border-accent/30"
        >
          <FileText className="h-5 w-5 shrink-0 text-text-secondary" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">
              {artifact.title}
            </p>
            <p className="text-xs text-text-tertiary">
              {shortDate(artifact.createdAt)} · {artifact.sourceIds.length} sources
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
        </button>
      ))}
    </div>
  );
}
