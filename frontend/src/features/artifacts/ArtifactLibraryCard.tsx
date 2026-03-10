import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Table2,
  BarChart3,
  FileText,
  LayoutDashboard,
  Star,
  Download,
  MoreHorizontal,
  ArrowRightToLine,
  ExternalLink,
  Pencil,
  Share2,
  Lock,
  Trash2,
} from 'lucide-react';
import type { ArtifactListItem, ArtifactDetail } from '../../api/endpoints/artifacts.ts';
import { getArtifact } from '../../api/endpoints/artifacts.ts';
import { useUpdateArtifact, useDeleteArtifact } from './hooks/useArtifacts.ts';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { downloadCsv } from '../../lib/download-csv.ts';
import { timeAgo } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx';
import { Input } from '../../components/ui/input.tsx';
import { UnderlyingDataDialog } from '../studio/UnderlyingDataDialog.tsx';

const ARTIFACT_STYLES: Record<string, { icon: typeof Table2; color: string; bg: string; label: string }> = {
  data_export: { icon: Table2, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Data Export' },
  insight_report: { icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10', label: 'Report' },
  chart: { icon: BarChart3, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Chart' },
  dashboard: { icon: LayoutDashboard, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Dashboard' },
};

function convertToStudioArtifact(detail: ArtifactDetail): Artifact {
  const base = {
    id: detail.artifact_id,
    title: detail.title,
    createdAt: new Date(detail.created_at),
  };
  const p = detail.payload;

  switch (detail.type) {
    case 'insight_report':
      return {
        ...base,
        type: 'insight_report',
        cards: (p.cards ?? []) as Artifact extends { type: 'insight_report' } ? Artifact['cards'] : never,
        collectionIds: detail.collection_ids,
        dateFrom: p.date_from as string | undefined,
        dateTo: p.date_to as string | undefined,
      } as Extract<Artifact, { type: 'insight_report' }>;
    case 'chart':
      return {
        ...base,
        type: 'chart',
        chartType: p.chart_type as string,
        data: (p.data ?? []) as unknown[],
        colorOverrides: p.color_overrides as Record<string, string> | undefined,
        collectionIds: detail.collection_ids,
      } as Extract<Artifact, { type: 'chart' }>;
    case 'data_export':
      return {
        ...base,
        type: 'data_export',
        rows: (p.rows ?? []) as Extract<Artifact, { type: 'data_export' }>['rows'],
        rowCount: (p.row_count ?? 0) as number,
        columnNames: (p.column_names ?? []) as string[],
        sourceIds: detail.collection_ids,
      } as Extract<Artifact, { type: 'data_export' }>;
    case 'dashboard':
      return {
        ...base,
        type: 'dashboard',
        collectionIds: detail.collection_ids,
        collectionNames: (p.collection_names ?? {}) as Record<string, string>,
      } as Extract<Artifact, { type: 'dashboard' }>;
  }
}

interface ArtifactLibraryCardProps {
  artifact: ArtifactListItem;
  view: 'grid' | 'list';
}

export function ArtifactLibraryCard({ artifact, view }: ArtifactLibraryCardProps) {
  const navigate = useNavigate();
  const updateMutation = useUpdateArtifact();
  const deleteMutation = useDeleteArtifact();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(artifact.title);
  const [loading, setLoading] = useState(false);
  const [underlyingDataId, setUnderlyingDataId] = useState<string | null>(null);

  const style = ARTIFACT_STYLES[artifact.type] ?? ARTIFACT_STYLES.chart;
  const Icon = style.icon;

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateMutation.mutate({
      id: artifact.artifact_id,
      updates: { favorited: !artifact.favorited },
    });
  };

  const handleRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== artifact.title) {
      updateMutation.mutate({ id: artifact.artifact_id, updates: { title: trimmed } });
    }
    setIsRenaming(false);
  };

  const handleShare = () => {
    updateMutation.mutate({
      id: artifact.artifact_id,
      updates: { shared: !artifact.shared },
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(artifact.artifact_id);
    setShowDeleteDialog(false);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (artifact.type !== 'data_export') return;
    setLoading(true);
    try {
      const detail = await getArtifact(artifact.artifact_id);
      const rows = (detail.payload.rows ?? []) as Record<string, unknown>[];
      downloadCsv(rows, artifact.title.replace(/\s+/g, '_').toLowerCase());
    } finally {
      setLoading(false);
    }
  };

  const handleUseInSession = async () => {
    setLoading(true);
    try {
      const detail = await getArtifact(artifact.artifact_id);
      const studioArtifact = convertToStudioArtifact(detail);

      if (detail.collection_ids.length > 0) {
        useSourcesStore.getState().selectByIds(detail.collection_ids);
      }

      useStudioStore.getState().loadExternalArtifact(studioArtifact);
      useStudioStore.getState().setActiveTab('artifacts');
      useStudioStore.getState().expandReport(studioArtifact.id);
      useUIStore.getState().expandStudioPanel();
      useUIStore.getState().closeArtifactLibrary();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSession = () => {
    useUIStore.getState().closeArtifactLibrary();
    navigate(`/session/${artifact.session_id}`);
  };

  if (view === 'list') {
    return (
      <>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/20">
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', style.bg)}>
            <Icon className={cn('h-3.5 w-3.5', style.color)} />
          </div>
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                className="h-6 text-sm"
                autoFocus
              />
            ) : (
              <p className="truncate text-sm font-medium">{artifact.title}</p>
            )}
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{style.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(artifact.created_at)}</span>
          <button onClick={handleFavorite} className="shrink-0">
            <Star
              className={cn(
                'h-3.5 w-3.5 transition-colors',
                artifact.favorited ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400',
              )}
            />
          </button>
          {artifact.type === 'data_export' && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleDownload} disabled={loading}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {artifact.collection_ids.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => setUnderlyingDataId(artifact.artifact_id)}>
                    <Table2 className="mr-2 h-3.5 w-3.5" />
                    Show underlying data
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleUseInSession} disabled={loading}>
                <ArrowRightToLine className="mr-2 h-3.5 w-3.5" />
                Use in Session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenSession}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Open Original Session
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setRenameValue(artifact.title); setIsRenaming(true); }}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShare}>
                {artifact.shared ? <Lock className="mr-2 h-3.5 w-3.5" /> : <Share2 className="mr-2 h-3.5 w-3.5" />}
                {artifact.shared ? 'Make Private' : 'Share with Org'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{artifact.title}&rdquo;. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <UnderlyingDataDialog artifactId={underlyingDataId} onClose={() => setUnderlyingDataId(null)} />
      </>
    );
  }

  // Grid view
  return (
    <>
      <div className="flex aspect-square min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/20 hover:shadow-md">
        {/* Top row: icon + favorite */}
        <div className="flex items-start justify-between">
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', style.bg)}>
            <Icon className={cn('h-4.5 w-4.5', style.color)} />
          </div>
          <button onClick={handleFavorite}>
            <Star
              className={cn(
                'h-4 w-4 transition-colors',
                artifact.favorited ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30 hover:text-amber-400',
              )}
            />
          </button>
        </div>

        {/* Title */}
        <div className="mt-3 min-h-[2.5rem] flex-1">
          {isRenaming ? (
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              className="h-7 text-sm"
              autoFocus
            />
          ) : (
            <p className="line-clamp-2 text-sm font-medium leading-tight">{artifact.title}</p>
          )}
        </div>

        {/* Meta */}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {style.label} · {timeAgo(artifact.created_at)}
        </p>
        {artifact.shared && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Share2 className="h-2.5 w-2.5" /> Shared
          </span>
        )}

        {/* Actions row */}
        <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
          {artifact.type === 'data_export' ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleDownload} disabled={loading}>
              <Download className="h-3 w-3" />
              CSV
            </Button>
          ) : (
            <div />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {artifact.collection_ids.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => setUnderlyingDataId(artifact.artifact_id)}>
                    <Table2 className="mr-2 h-3.5 w-3.5" />
                    Show underlying data
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleUseInSession} disabled={loading}>
                <ArrowRightToLine className="mr-2 h-3.5 w-3.5" />
                Use in Session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenSession}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Open Original Session
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setRenameValue(artifact.title); setIsRenaming(true); }}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShare}>
                {artifact.shared ? <Lock className="mr-2 h-3.5 w-3.5" /> : <Share2 className="mr-2 h-3.5 w-3.5" />}
                {artifact.shared ? 'Make Private' : 'Share with Org'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{artifact.title}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnderlyingDataDialog artifactId={underlyingDataId} onClose={() => setUnderlyingDataId(null)} />
    </>
  );
}
