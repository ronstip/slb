import { useState } from 'react';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  Eye,
  EyeOff,
  Globe,
  Lock,
  MoreHorizontal,
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
import { setCollectionVisibility, deleteCollection } from '../../api/endpoints/collections.ts';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/utils.ts';

interface SourceCardProps {
  source: Source;
}

export function SourceCard({ source }: SourceCardProps) {
  const { profile } = useAuth();
  const toggleSelected = useSourcesStore((s) => s.toggleSelected);
  const updateSource = useSourcesStore((s) => s.updateSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isProcessing = source.status === 'collecting' || source.status === 'enriching' || source.status === 'pending';
  const isReady = source.status === 'completed';
  const isFailed = source.status === 'failed';
  const isOwner = !source.userId || source.userId === profile?.uid;
  const isInOrg = !!profile?.org_id;
  const isShared = source.visibility === 'org';

  const platforms = source.config.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  const handleCardClick = () => {
    toggleSelected(source.collectionId);
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
    } catch {
      // handle error
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

  const statusDot = isProcessing
    ? 'bg-amber-500 animate-pulse'
    : isReady
      ? 'bg-emerald-500'
      : isFailed
        ? 'bg-red-500'
        : 'bg-muted-foreground';

  const statusLabel = isProcessing
    ? 'Processing'
    : isReady
      ? 'Ready'
      : isFailed
        ? 'Failed'
        : source.status;

  return (
    <>
      <div
        className={cn(
          'group relative flex cursor-pointer items-start rounded-lg border px-2 py-1.5 transition-all',
          source.selected
            ? 'border-primary/40 bg-primary/5'
            : 'border-transparent hover:border-border hover:bg-muted/50',
        )}
        onClick={handleCardClick}
      >
        {/* Content — min-w-0 + overflow-hidden ensures text truncates */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row with inline visibility badge */}
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium leading-tight text-foreground">
              {source.title}
            </span>
            {isShared ? (
              <Globe className="h-3 w-3 shrink-0 text-primary" />
            ) : (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            )}
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

          {/* Shared with you badge (only for non-owner) */}
          {!isOwner && (
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <Users className="h-2.5 w-2.5" />
                Shared with you
              </span>
            </div>
          )}
        </div>

        {/* Actions — always visible, fixed width */}
        <div className="ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {isInOrg && (
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
                {isInOrg && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
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
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
