import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { updateCollection } from '../../api/endpoints/collections.ts';
import type { Source } from '../../stores/sources-store.ts';

interface EditCollectionDialogProps {
  source: Source | null;
  open: boolean;
  onClose: () => void;
  hasOrg: boolean;
}

export function EditCollectionDialog({
  source,
  open,
  onClose,
  hasOrg,
}: EditCollectionDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [isOrg, setIsOrg] = useState(false);

  useEffect(() => {
    if (source) {
      setTitle(source.title);
      setIsOrg(source.visibility === 'org');
    }
  }, [source]);

  const mutation = useMutation({
    mutationFn: (updates: { title?: string; visibility?: string }) =>
      updateCollection(source!.collectionId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      toast.success('Collection updated');
      onClose();
    },
    onError: () => {
      toast.error('Failed to update collection');
    },
  });

  const handleSave = () => {
    if (!source) return;
    const updates: { title?: string; visibility?: string } = {};
    if (title.trim() && title.trim() !== source.title) {
      updates.title = title.trim();
    }
    const newVis = isOrg ? 'org' : 'private';
    if (newVis !== source.visibility) {
      updates.visibility = newVis;
    }
    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }
    mutation.mutate(updates);
  };

  if (!source) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-tight">Edit Collection</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="collection-title" className="text-xs">Title</Label>
            <Input
              id="collection-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>

          {/* Visibility */}
          {hasOrg && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Share with organization</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Make this collection visible to all org members
                </p>
              </div>
              <Switch checked={isOrg} onCheckedChange={setIsOrg} />
            </div>
          )}

          {/* Read-only info */}
          <div className="space-y-2 rounded-md bg-muted/30 p-3">
            <div>
              <span className="text-[10px] font-medium text-muted-foreground">Keywords</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {(source.config.keywords ?? []).map((k) => (
                  <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                ))}
                {(source.config.keywords ?? []).length === 0 && (
                  <span className="text-[10px] text-muted-foreground">None</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-[10px] font-medium text-muted-foreground">Platforms</span>
              <div className="flex items-center gap-2 mt-1">
                {(source.config.platforms ?? []).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <PlatformIcon platform={p} className="h-3 w-3" />
                    {PLATFORM_LABELS[p] || p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
