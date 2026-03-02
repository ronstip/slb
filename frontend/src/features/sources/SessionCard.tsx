import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSessionStore } from '../../stores/session-store.ts';
import { timeAgo, shortDate } from '../../lib/format.ts';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { cn } from '../../lib/utils.ts';
import type { SessionListItem } from '../../api/endpoints/sessions.ts';

interface SessionCardProps {
  session: SessionListItem;
}

export function SessionCard({ session }: SessionCardProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const removeSession = useSessionStore((s) => s.removeSession);
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const navigate = useNavigate();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isActive = session.session_id === activeSessionId;

  const handleClick = () => {
    if (isActive || isRestoring) return;
    // Navigate to the session URL — AppShell URL effect handles restore
    navigate(`/session/${session.session_id}`);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const wasActive = session.session_id === activeSessionId;
      await removeSession(session.session_id);
      setDeleteDialogOpen(false);
      // If we deleted the active session, navigate to home (new session)
      if (wasActive) {
        navigate('/');
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
          'group relative flex cursor-pointer items-start rounded-lg border px-2 py-1.5 transition-all',
          isActive
            ? 'border-primary/40 bg-primary/5'
            : 'border-transparent hover:border-border hover:bg-muted/50',
          isRestoring && !isActive && 'pointer-events-none opacity-50',
        )}
        onClick={handleClick}
      >
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title */}
          <span className="truncate text-[13px] font-medium leading-tight text-foreground block">
            {session.title}
          </span>

          {/* Meta row */}
          <div className="mt-0.5 flex items-center gap-x-1.5 text-[10px] text-muted-foreground">
            {(session.updated_at || session.created_at) && (
              <>
                <span className="whitespace-nowrap">{shortDate((session.updated_at || session.created_at)!)}</span>
                <span className="text-border">·</span>
                <span className="whitespace-nowrap">{timeAgo((session.updated_at || session.created_at)!)}</span>
              </>
            )}
            {session.message_count > 0 && (
              <>
                <span className="text-border">·</span>
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
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
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
