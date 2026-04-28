import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Download } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { apiGetBlob } from '../../api/client.ts';
import { getArtifact } from '../../api/endpoints/artifacts.ts';
import { ARTIFACT_STYLES, convertToStudioArtifact } from './artifact-utils.ts';
import { ChartArtifactView } from '../studio/ChartArtifactView.tsx';
import { DataExportView } from '../studio/DataExportView.tsx';
import { cn } from '../../lib/utils.ts';
import type { Artifact } from '../../stores/studio-store.ts';

export function StandaloneArtifactPage() {
  const { artifactId } = useParams<{ artifactId: string }>();
  const navigate = useNavigate();

  const { data: detail, isLoading, error } = useQuery({
    queryKey: ['artifact-standalone', artifactId],
    queryFn: () => getArtifact(artifactId!),
    enabled: !!artifactId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const artifact = detail ? convertToStudioArtifact(detail) : null;
  const style = detail && artifact ? ARTIFACT_STYLES[detail.type] ?? ARTIFACT_STYLES.chart : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo size="sm" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-3 w-3" />
            Back to app
          </Button>
        </div>
      </header>

      {/* Loading */}
      {isLoading && (
        <div className="mx-auto max-w-6xl px-6 py-8 space-y-4">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {/* Error or unsupported artifact (e.g. legacy dashboard) */}
      {(error || (!isLoading && !artifact)) && (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Artifact not available</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This artifact may have been deleted or you don't have access.
          </p>
          <Button className="mt-6" onClick={() => navigate('/')}>
            Go to app
          </Button>
        </div>
      )}

      {/* Artifact content */}
      {!isLoading && !error && artifact && style && (
        <>
          <div className="border-b border-border bg-card shrink-0">
            <div className="mx-auto max-w-6xl px-6 py-4">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', style.bg)}>
                  <style.icon className={cn('h-4.5 w-4.5', style.color)} />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    {artifact.title}
                  </h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {style.label}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <main className="mx-auto max-w-6xl">
            <ArtifactRenderer artifact={artifact} />
          </main>
        </>
      )}
    </div>
  );
}

function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'chart':
      return <ChartArtifactView artifact={artifact} />;
    case 'data_export':
      return <DataExportView artifact={artifact} />;
    case 'presentation':
      return <PresentationDownloadView artifact={artifact} />;
  }
}

function PresentationDownloadView({
  artifact,
}: {
  artifact: Extract<Artifact, { type: 'presentation' }>;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await apiGetBlob(`/presentations/${artifact.id}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact.title.replace(/\s+/g, '_').slice(0, 60)}.pptx`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const slideCount = artifact.slideCount;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10">
        <Download className="h-7 w-7 text-orange-500" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-foreground">
        {slideCount > 0
          ? `${slideCount} slide${slideCount === 1 ? '' : 's'} ready`
          : 'Presentation ready'}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Download the PowerPoint file to view, edit, or present this deck.
      </p>
      <Button
        className="mt-6 gap-2"
        onClick={handleDownload}
        disabled={downloading}
      >
        <Download className="h-4 w-4" />
        {downloading ? 'Preparing…' : 'Download .pptx'}
      </Button>
      {error && (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
