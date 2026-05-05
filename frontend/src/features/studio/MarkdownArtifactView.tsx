import { useState } from 'react';
import { ArrowLeft, Download, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { Markdown } from '../../components/Markdown.tsx';
import { UnderlyingDataDialog, type UnderlyingDataFallback } from './UnderlyingDataDialog.tsx';

interface MarkdownArtifactViewProps {
  artifact: Extract<Artifact, { type: 'markdown' }>;
}

function downloadMarkdown(title: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_').slice(0, 60) || 'report'}.md`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MarkdownArtifactView({ artifact }: MarkdownArtifactViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);
  const hasUnderlyingData = (artifact.collectionIds?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
        <div className="flex items-center gap-1.5">
          {hasUnderlyingData && (
            <button
              onClick={() => setShowUnderlyingData(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Table2 className="h-3.5 w-3.5" />
              Data
            </button>
          )}
          <button
            onClick={() => downloadMarkdown(artifact.title, artifact.content)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download .md
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-12 pt-6">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">
            {artifact.title}
          </h1>
          {artifact.summary && (
            <p className="mb-6 text-sm text-muted-foreground">{artifact.summary}</p>
          )}
          <Markdown
            className="agent-prose max-w-none break-words text-sm leading-relaxed"
            autoDir
          >
            {artifact.content}
          </Markdown>
        </div>
      </div>

      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        fallback={hasUnderlyingData ? {
          collectionIds: artifact.collectionIds!,
          createdAt: artifact.createdAt.toISOString(),
          sourceSql: artifact.sourceSql,
        } as UnderlyingDataFallback : undefined}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}
