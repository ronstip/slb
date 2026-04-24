import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { timeAgo, shortDate } from '../lib/format.ts';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.tsx';
import { cn } from '../lib/utils.ts';
import type { ExplorerLayoutListItem } from '../api/endpoints/explorer-layouts.ts';
import { useExplorerLayoutStore } from '../stores/explorer-layout-store.ts';

interface LayoutCardProps {
  layout: ExplorerLayoutListItem;
  isActive: boolean;
  onSelect: (layoutId: string) => void;
}

export function LayoutCard({ layout, isActive, onSelect }: LayoutCardProps) {
  const removeLayout = useExplorerLayoutStore((s) => s.removeLayout);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleClick = () => {
    if (isActive) return;
    onSelect(layout.layout_id);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await removeLayout(layout.layout_id);
      setDeleteDialogOpen(false);
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
        )}
        onClick={handleClick}
      >
        {isActive && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent-vibrant" />
        )}

        <div className="min-w-0 flex-1 overflow-hidden pl-1">
          <span className={cn(
            'block truncate text-sm',
            isActive ? 'font-semibold' : 'font-medium',
          )}>
            {layout.title}
          </span>

          <div className="mt-1 flex items-center gap-x-1.5 text-[10px] text-muted-foreground">
            {layout.updated_at && (
              <>
                <span className="whitespace-nowrap">{shortDate(layout.updated_at)}</span>
                <span className="opacity-40">&middot;</span>
                <span className="whitespace-nowrap">{timeAgo(layout.updated_at)}</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Layout</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{layout.title}"? This action cannot be undone.
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
