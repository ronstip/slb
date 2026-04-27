import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Link, Loader2, Trash2, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import {
  getBriefingShare,
  createBriefingShare,
  revokeBriefingShare,
} from '../../api/endpoints/briefings.ts';
import type { BriefingShareInfo } from '../../api/types.ts';

interface ShareBriefingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  title: string;
}

export function ShareBriefingDialog({
  open,
  onOpenChange,
  agentId,
  title,
}: ShareBriefingDialogProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: share, isLoading } = useQuery<BriefingShareInfo | null>({
    queryKey: ['briefing-share', agentId],
    queryFn: () => getBriefingShare(agentId),
    enabled: open,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: () => createBriefingShare({ agent_id: agentId, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-share', agentId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeBriefingShare(share!.token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-share', agentId] });
    },
  });

  const handleCopy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.share_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share Briefing
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can view this briefing without signing in.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && !share && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Link className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                No shareable link yet. Create one to share this briefing with anyone.
              </p>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="w-full"
              >
                {createMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create shareable link
              </Button>
            </div>
          )}

          {!isLoading && share && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={share.share_url}
                  readOnly
                  className="h-8 text-xs font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Created {new Date(share.created_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        {share && (
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => revokeMutation.mutate()}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-3.5 w-3.5" />
              )}
              Revoke link
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
