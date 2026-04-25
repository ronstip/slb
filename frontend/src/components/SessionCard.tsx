import { useState } from 'react';
import { useSessionStore } from '../stores/session-store.ts';
import { timeAgo, shortDate } from '../lib/format.ts';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.tsx';
import { cn } from '../lib/utils.ts';
import type { SessionListItem } from '../api/endpoints/sessions.ts';

interface SessionCardProps {
  session: SessionListItem;
  onSelect: (sessionId: string) => void;
  onDeleted?: () => void;
}

export function SessionCard({ session, onSelect, onDeleted }: SessionCardProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const removeSession = useSessionStore((s) => s.removeSession);
  const isRestoring = useSessionStore((s) => s.isRestoring);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isActive = session.session_id === activeSessionId;

  const handleClick = () => {
    if (isActive || isRestoring) return;
    onSelect(session.session_id);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const wasActive = session.session_id === activeSessionId;
      await removeSession(session.session_id);
      setDeleteDialogOpen(false);
      if (wasActive && onDeleted) {
        onDeleted();
      }
    } catch {
      // deletion failed
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'group relative flex cursor-pointer items-start rounded-lg px-2 py-2 transition-all duration-150',
          isActive
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
          isRestoring && !isActive && 'pointer-events-none opacity-50',
        )}
        onClick={handleClick}
      >
        {/* Left accent bar for active state */}
        {isActive && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent-vibrant" />
        )}

        <div className="min-w-0 flex-1 overflow-hidden pl-1">
          {/* Title or first-message preview for untitled sessions */}
          <span className={cn(
            'block truncate text-sm',
            isActive ? 'font-semibold' : 'font-medium',
          )}>
            {session.title || session.preview || 'New session'}
          </span>

          {/* Meta row */}
          <div className="mt-1 flex items-center gap-x-1.5 text-[10px] text-muted-foreground">
            {(session.updated_at || session.created_at) && (
              <>
                <span className="whitespace-nowrap">{shortDate((session.updated_at || session.created_at)!)}</span>
                <span className="opacity-40">·</span>
                <span className="whitespace-nowrap">{timeAgo((session.updated_at || session.created_at)!)}</span>
              </>
            )}
            {session.message_count > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MessageSquare className="h-2.5 w-2.5" />
                  {session.message_count}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Delete button on hover */}
        <div className="ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{session.title}"? This action cannot be undone.
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
