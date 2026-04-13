import { useState } from 'react';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  BarChart2,
  Check,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  LogOut,
  MoreHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import {
  setCollectionVisibility,
  deleteCollection,
  downloadCollection,
} from '../../api/endpoints/collections.ts';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/utils.ts';
import { StatsModal } from './StatsModal.tsx';
import { TableModal } from './TableModal.tsx';

interface SourceCardProps {
  source: Source;
}

export function SourceCard({ source }: SourceCardProps) {
  const { profile } = useAuth();
  const toggleActive = useSourcesStore((s) => s.toggleActive);
  const removeFromSession = useSourcesStore((s) => s.removeFromSession);
  const updateSource = useSourcesStore((s) => s.updateSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isProcessing = source.status === 'running';
  const isPaused = false; // paused status removed
  const isReady = source.status === 'success';
  const isFailed = source.status === 'failed';
  const isOwner = !source.userId || source.userId === profile?.uid;
  const isInOrg = !!profile?.org_id;
  const isShared = source.visibility === 'org';
  const isAgentSelected = useSourcesStore((s) => s.agentSelectedIds.includes(source.collectionId));

  const platforms = source.config.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  const handleCardClick = () => {
    setFeedSource(source.collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) {
      toggleStudioPanel();
    }
  };

  const handleToggleVisibility = async (e: Event) => {
    e.stopPropagation();
    const newVisibility = isShared ? 'private' : 'org';
    try {
      await setCollectionVisibility(source.collectionId, newVisibility);
      updateSource(source.collectionId, { visibility: newVisibility });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch (err) {
      console.error('Source operation failed:', err);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCollection(source.collectionId);
      removeSource(source.collectionId);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setDeleteDialogOpen(false);
    } catch {
      // handle error
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadCollection(source.collectionId, source.title);
    } catch {
      // handle error
    } finally {
      setDownloading(false);
    }
  };

  const statusDot = isProcessing
    ? 'bg-amber-500 animate-pulse'
    : isPaused
      ? 'bg-amber-500'
      : isReady
        ? 'bg-emerald-500'
        : isFailed
          ? 'bg-red-500'
          : 'bg-muted-foreground';

  const statusLabel = isProcessing
    ? 'Processing'
    : isPaused
      ? 'Paused'
      : isReady
        ? 'Ready'
        : isFailed
          ? 'Failed'
          : source.status;

  return (
    <>
      <div
        className={cn(
          'group relative flex cursor-pointer items-start rounded-lg border py-1.5 pl-3.5 pr-2 transition-all',
          source.active
            ? 'border-accent-vibrant/30 bg-accent-vibrant/5'
            : 'border-transparent hover:border-border/60 hover:bg-muted/50',
        )}
        onClick={handleCardClick}
      >
        {/* Left accent bar */}
        <div
          className={cn(
            'absolute left-1 top-[12%] bottom-[12%] w-[3px] rounded-full transition-all duration-200',
            source.active
              ? 'bg-accent-vibrant'
              : 'bg-transparent',
          )}
        />

        {/* Context toggle */}
        <div
          className="mt-0.5 mr-1.5 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            toggleActive(source.collectionId);
          }}
          title={source.active ? 'Remove from agent context' : 'Include in agent context'}
        >
          <div
            className={cn(
              'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-2 transition-all duration-150',
              source.active
                ? 'border-foreground bg-foreground'
                : 'border-muted-foreground/30 bg-transparent hover:border-foreground/60',
            )}
          >
            {source.active && <Check className="h-2.5 w-2.5 text-primary-foreground stroke-[3]" />}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] leading-tight',
                source.active ? 'font-semibold text-foreground' : 'font-medium text-foreground',
              )}
            >
              {source.title}
            </span>
            {isAgentSelected && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1 py-px" title="Selected by agent">
                <Sparkles className="h-2.5 w-2.5 text-violet-500" />
                <span className="text-[8px] font-semibold uppercase tracking-wider text-violet-500">AI</span>
              </span>
            )}
            {isShared && <Globe className="h-3 w-3 shrink-0 text-accent-blue" />}
          </div>

          {/* Meta row */}
          <div className="mt-0.5 flex items-center gap-x-1.5 overflow-hidden text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
              {statusLabel}
            </span>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">{formatNumber(source.postsCollected)} posts</span>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">{shortDate(source.createdAt)}</span>
            {platforms && (
              <>
                <span className="text-border">·</span>
                <span className="truncate">{platforms}</span>
              </>
            )}
          </div>

          {/* Shared badge */}
          {!isOwner && (
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <Users className="h-2.5 w-2.5" />
                Shared with you
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Data inspection */}
              <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                <BarChart2 className="mr-2 h-3.5 w-3.5" />
                View Stats
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTableOpen(true)}>
                <Table2 className="mr-2 h-3.5 w-3.5" />
                View Table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-2 h-3.5 w-3.5" />
                )}
                {downloading ? 'Downloading...' : 'Download CSV'}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Session */}
              <DropdownMenuItem onSelect={() => removeFromSession(source.collectionId)}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Remove from session
              </DropdownMenuItem>

              {/* Visibility */}
              {isOwner && isInOrg && (
                <DropdownMenuItem onSelect={handleToggleVisibility}>
                  {isShared ? (
                    <>
                      <EyeOff className="mr-2 h-3.5 w-3.5" />
                      Make Private
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-3.5 w-3.5" />
                      Share with Org
                    </>
                  )}
                </DropdownMenuItem>
              )}

              {/* Delete */}
              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Modals */}
      <StatsModal source={source} open={statsOpen} onClose={() => setStatsOpen(false)} />
      <TableModal source={source} open={tableOpen} onClose={() => setTableOpen(false)} />

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{source.title}"? This will permanently remove all collected data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
