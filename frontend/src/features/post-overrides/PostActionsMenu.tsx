import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, EyeOff, Pencil, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { cn } from '../../lib/utils.ts';
import type { FeedPost } from '../../api/types.ts';
import { fetchPostComments, overridePostEnrichment } from '../../api/endpoints/posts.ts';
import { EditPostDrawer } from './EditPostDrawer.tsx';

interface PostActionsMenuProps {
  post: FeedPost;
  agentId?: string;
  /** Override the collection_id from the post (Data page passes the active collection). */
  collectionIdOverride?: string;
  className?: string;
}

/** Small overflow menu for per-post manual corrections (Exclude / Edit details).
 *
 * Renders nothing when `agentId` is missing — overrides are scoped per
 * (post, agent) and we only show the affordance where that's defined.
 */
export function PostActionsMenu({ post, agentId, collectionIdOverride, className }: PostActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [excludeConfirmOpen, setExcludeConfirmOpen] = useState(false);
  const [fetchCommentsConfirmOpen, setFetchCommentsConfirmOpen] = useState(false);
  const qc = useQueryClient();
  const collectionId = collectionIdOverride ?? post.collection_id;
  const commentsSupported = post.platform === 'twitter';

  const excludeMutation = useMutation({
    mutationFn: () => {
      if (!agentId || !collectionId) {
        throw new Error('Missing agent or collection');
      }
      return overridePostEnrichment(post.post_id, {
        agent_id: agentId,
        collection_id: collectionId,
        fields: { is_related_to_task: false },
      });
    },
    onSuccess: () => {
      // Refresh feeds & overview counts. Loose match on the family of keys
      // that depend on this collection's posts.
      qc.invalidateQueries({ queryKey: ['feed-posts'] });
      qc.invalidateQueries({ queryKey: ['live-feed-count'] });
      qc.invalidateQueries({ queryKey: ['collection-posts'] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: () => {
      if (!agentId || !collectionId) {
        throw new Error('Missing agent or collection');
      }
      return overridePostEnrichment(post.post_id, {
        agent_id: agentId,
        collection_id: collectionId,
        fields: { is_related_to_task: true },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed-posts'] });
      qc.invalidateQueries({ queryKey: ['live-feed-count'] });
      qc.invalidateQueries({ queryKey: ['collection-posts'] });
    },
  });

  const fetchCommentsMutation = useMutation({
    mutationFn: () => fetchPostComments(post.post_id, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collection-posts'] });
    },
  });

  if (!agentId || !collectionId) return null;

  const requestExclude = () => {
    setOpen(false);
    setExcludeConfirmOpen(true);
  };

  const confirmExclude = () => {
    setExcludeConfirmOpen(false);
    excludeMutation.mutate(undefined, {
      onSuccess: () => {
        toast('Excluded from agent', {
          description: 'This post will no longer appear in analysis.',
          duration: 10_000,
          action: {
            label: 'Undo',
            onClick: () => {
              undoMutation.mutate();
            },
          },
        });
      },
      onError: (err) => {
        toast.error('Could not exclude post', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      },
    });
  };

  const requestFetchComments = () => {
    setOpen(false);
    setFetchCommentsConfirmOpen(true);
  };

  const confirmFetchComments = () => {
    setFetchCommentsConfirmOpen(false);
    fetchCommentsMutation.mutate(undefined, {
      onSuccess: () => {
        toast('Fetching comments…', {
          description: "We'll add replies to this post once they arrive.",
        });
      },
      onError: (err) => {
        toast.error('Could not fetch comments', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      },
    });
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Post actions"
            onClick={(e) => {
              // preventDefault keeps a parent <a> from navigating; we let the
              // event bubble so a parent <tr onClick> (data table) can still
              // toggle row expansion alongside the menu opening.
              e.preventDefault();
            }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md',
              'text-muted-foreground/80 hover:bg-accent hover:text-foreground',
              'transition-colors',
              className,
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              setEditorOpen(true);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit enrichment…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={requestFetchComments}
            disabled={!commentsSupported || fetchCommentsMutation.isPending}
          >
            <MessagesSquare className="mr-2 h-4 w-4" />
            Fetch comments
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={requestExclude}
            disabled={excludeMutation.isPending}
            className="text-destructive focus:text-destructive"
          >
            <EyeOff className="mr-2 h-4 w-4" />
            Exclude from agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditPostDrawer
        open={editorOpen}
        onOpenChange={setEditorOpen}
        post={post}
        agentId={agentId}
        collectionId={collectionId}
      />

      <AlertDialog open={excludeConfirmOpen} onOpenChange={setExcludeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exclude this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This post will be hidden from the agent's analysis. You can undo
              from the toast within 10 seconds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExclude}>
              Exclude
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={fetchCommentsConfirmOpen} onOpenChange={setFetchCommentsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fetch comments?</AlertDialogTitle>
            <AlertDialogDescription>
              Pulls the full reply tree for this post via the X API. May take
              ~30 seconds and counts against your X API quota.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmFetchComments}>
              Fetch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
