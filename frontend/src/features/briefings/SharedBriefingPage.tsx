import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Loader2, Share2, Trash2 } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import {
  getPublicBriefing,
  revokeBriefingShare,
} from '../../api/endpoints/briefings.ts';
import { BriefingView } from './BriefingView.tsx';

export function SharedBriefingPage() {
  const { token } = useParams<{ token: string }>();
  const [shareOpen, setShareOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-briefing', token],
    queryFn: () => getPublicBriefing(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2.5">
          <Logo size="sm" />
          {data?.meta.title && (
            <>
              <div className="h-4 w-px bg-border shrink-0" />
              <h1 className="text-sm font-semibold text-foreground truncate flex-1">
                {data.meta.title}
              </h1>
            </>
          )}
          {!data?.meta.title && <div className="flex-1" />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShareOpen(true)}
            className="h-7 gap-1.5 text-xs shrink-0"
            disabled={!token || isLoading}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
          <Button
            size="sm"
            onClick={() => window.open('/', '_blank')}
            className="h-7 text-xs shrink-0"
          >
            Create your own
          </Button>
        </div>
      </header>

      {isLoading && (
        <div className="mx-auto max-w-[1200px] px-8 py-10 space-y-4">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
            <Skeleton className="aspect-[5/4] rounded-md" />
            <Skeleton className="h-72 rounded-md" />
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Briefing not available</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This link may have been revoked or doesn't exist.
          </p>
          <Button className="mt-6" onClick={() => window.open('/', '_blank')}>
            Try Veille
          </Button>
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          <main>
            <BriefingView title={data.meta.title} briefing={data.layout} />
          </main>

          <footer className="mt-16 border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-10 text-center">
              <h2 className="text-base font-semibold">Like what you see?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Veille gives you AI-powered social intelligence briefings like this one &mdash; no coding required.
              </p>
              <Button
                className="mt-4"
                size="lg"
                onClick={() => window.open('/', '_blank')}
              >
                Start for free
              </Button>
            </div>
          </footer>
        </>
      )}

      {token && (
        <BriefingShareLinkDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          token={token}
          createdAt={data?.meta.created_at}
        />
      )}
    </div>
  );
}

function BriefingShareLinkDialog({
  open,
  onOpenChange,
  token,
  createdAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  createdAt?: string;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const url = window.location.href;

  const revokeMutation = useMutation({
    mutationFn: () => revokeBriefingShare(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-briefing', token] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to revoke';
      setRevokeError(msg);
    },
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
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
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input value={url} readOnly className="h-8 text-xs font-mono" />
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
            {createdAt && (
              <p className="text-xs text-muted-foreground">
                Created {new Date(createdAt).toLocaleDateString()}
              </p>
            )}
            {revokeError && (
              <p className="text-xs text-destructive">{revokeError}</p>
            )}
          </div>
        </div>

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
      </DialogContent>
    </Dialog>
  );
}
