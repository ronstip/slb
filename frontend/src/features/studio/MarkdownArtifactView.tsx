import { useRef, useState } from 'react';
import { ArrowLeft, Download, FileImage, Printer, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { Markdown } from '../../components/Markdown.tsx';
import { chartToCanvas } from '../../lib/chart-export.ts';
import { UnderlyingDataDialog, type UnderlyingDataFallback } from './UnderlyingDataDialog.tsx';

interface MarkdownArtifactViewProps {
  artifact: Extract<Artifact, { type: 'markdown' }>;
}

const CHART_FENCE_RE = /```chart\n([\s\S]*?)\n```/g;

function fileNameFor(title: string) {
  return title.replace(/\s+/g, '_').slice(0, 60) || 'report';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadMarkdown(title: string, content: string) {
  triggerDownload(
    new Blob([content], { type: 'text/markdown;charset=utf-8' }),
    `${fileNameFor(title)}.md`,
  );
}

function canonicalizeSpec(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function buildPortableMarkdown(source: string, container: HTMLElement): Promise<string> {
  const figures = Array.from(container.querySelectorAll<HTMLElement>('figure[data-report-chart]'));
  const map = new Map<string, string>();
  for (const fig of figures) {
    const specRaw = fig.getAttribute('data-chart-spec');
    if (!specRaw) continue;
    const key = canonicalizeSpec(specRaw);
    if (!key) continue;
    const canvas = await chartToCanvas(fig);
    map.set(key, canvas.toDataURL('image/png'));
  }
  return source.replace(CHART_FENCE_RE, (full, body: string) => {
    const key = canonicalizeSpec(body);
    if (!key) return full;
    const dataUrl = map.get(key);
    if (!dataUrl) return full;
    let title = '';
    let caption = '';
    try {
      const spec = JSON.parse(body);
      title = String(spec.title ?? '');
      caption = String(spec.caption ?? '');
    } catch {
      // unreachable — canonicalizeSpec already validated JSON
    }
    const alt = title || 'chart';
    const titleLine = title ? `**${title}**\n\n` : '';
    const captionLine = caption ? `\n\n*${caption}*` : '';
    return `${titleLine}![${alt}](${dataUrl})${captionLine}`;
  });
}

export function MarkdownArtifactView({ artifact }: MarkdownArtifactViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasUnderlyingData = (artifact.collectionIds?.length ?? 0) > 0;

  const handlePortableDownload = async () => {
    if (!contentRef.current || exporting) return;
    setExporting(true);
    try {
      const portable = await buildPortableMarkdown(artifact.content, contentRef.current);
      triggerDownload(
        new Blob([portable], { type: 'text/markdown;charset=utf-8' }),
        `${fileNameFor(artifact.title)}.portable.md`,
      );
    } catch (err) {
      console.error('Portable .md export failed', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="no-print shrink-0 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
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
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF
          </button>
          <button
            onClick={handlePortableDownload}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            <FileImage className="h-3.5 w-3.5" />
            {exporting ? 'Exporting…' : '.md (portable)'}
          </button>
          <button
            onClick={() => downloadMarkdown(artifact.title, artifact.content)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            .md (raw)
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto report-print-target">
        <div ref={contentRef} className="mx-auto max-w-3xl px-6 pb-12 pt-6">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground">
            {artifact.title}
          </h1>
          {artifact.summary && (
            <p className="mb-6 text-sm text-muted-foreground">{artifact.summary}</p>
          )}
          <Markdown
            className="agent-prose max-w-none break-words text-sm leading-relaxed"
            autoDir
            renderCharts
            headingIds
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
