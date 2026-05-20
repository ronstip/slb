import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Link, Loader2, Trash2, Share2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import {
  getDashboardShare,
  createDashboardShare,
  revokeDashboardShare,
  getCustomSlugShare,
  createCustomSlugShare,
} from '../../../api/endpoints/dashboard.ts';
import { ApiError } from '../../../api/client.ts';
import { useAuth } from '../../../auth/useAuth.ts';
import type { DashboardShareInfo } from '../../../api/types.ts';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

function validateSlugClient(slug: string): string | null {
  if (slug.length < 3 || slug.length > 64) return 'Use 3–64 characters.';
  if (slug.includes('--')) return 'No consecutive hyphens.';
  if (!SLUG_RE.test(slug)) return 'Lowercase letters, digits, and single hyphens only.';
  return null;
}

interface ShareDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  collectionIds: string[];
  title: string;
  /** When the dashboard belongs to an agent, persist agent_id on the share so
   *  the public render uses the same scope_posts TVF view. */
  agentId?: string;
}

export function ShareDashboardDialog({
  open,
  onOpenChange,
  dashboardId,
  collectionIds,
  title,
  agentId,
}: ShareDashboardDialogProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [customCopied, setCustomCopied] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);

  const { data: share, isLoading } = useQuery<DashboardShareInfo | null>({
    queryKey: ['dashboard-share', dashboardId],
    queryFn: () => getDashboardShare(dashboardId),
    enabled: open,
    staleTime: 0,
  });

  // Admin status from the cached user profile — avoids calling `/admin/check`,
  // which 403s during impersonation and would bounce the user to /access-denied
  // via the global API error handler. Also matches AppSidebar's gating: the
  // section hides itself when an admin is viewing the app as another user.
  const { profile } = useAuth();
  const isAdmin = !!profile?.is_super_admin && !profile?.impersonation;

  const { data: customShare } = useQuery<DashboardShareInfo | null>({
    queryKey: ['dashboard-custom-share', dashboardId],
    queryFn: () => getCustomSlugShare(dashboardId),
    enabled: open && isAdmin,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createDashboardShare({
        dashboard_id: dashboardId,
        collection_ids: collectionIds,
        title,
        agent_id: agentId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-share', dashboardId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeDashboardShare(share!.token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-share', dashboardId] });
    },
  });

  const createCustomMutation = useMutation({
    mutationFn: (slug: string) =>
      createCustomSlugShare({
        dashboard_id: dashboardId,
        collection_ids: collectionIds,
        title,
        agent_id: agentId,
        slug,
      }),
    onSuccess: () => {
      setSlugInput('');
      setSlugError(null);
      queryClient.invalidateQueries({ queryKey: ['dashboard-custom-share', dashboardId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setSlugError('That slug is already taken.');
      } else if (err instanceof ApiError && err.status === 422) {
        setSlugError('Invalid or reserved slug.');
      } else {
        setSlugError('Could not create custom link.');
      }
    },
  });

  const revokeCustomMutation = useMutation({
    mutationFn: () => revokeDashboardShare(customShare!.token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-custom-share', dashboardId] });
    },
  });

  const handleCopy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.share_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCustomCopy = async () => {
    if (!customShare) return;
    await navigator.clipboard.writeText(customShare.share_url);
    setCustomCopied(true);
    setTimeout(() => setCustomCopied(false), 2000);
  };

  const handleSlugChange = (value: string) => {
    setSlugInput(value);
    if (!value) {
      setSlugError(null);
      return;
    }
    setSlugError(validateSlugClient(value));
  };

  const handleCreateCustom = () => {
    const err = validateSlugClient(slugInput);
    if (err) {
      setSlugError(err);
      return;
    }
    createCustomMutation.mutate(slugInput);
  };

  const previewOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share Dashboard
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can view this dashboard without signing in.
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
                No shareable link yet. Create one to share this dashboard with anyone.
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

          {isAdmin && (
            <div className="mt-4 border-t pt-4 flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                Custom link (admin)
              </div>

              {customShare ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={customShare.share_url}
                      readOnly
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5"
                      onClick={handleCustomCopy}
                    >
                      {customCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {customCopied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(customShare.created_at).toLocaleDateString()}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => revokeCustomMutation.mutate()}
                      disabled={revokeCustomMutation.isPending}
                    >
                      {revokeCustomMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-3 w-3" />
                      )}
                      Revoke
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={slugInput}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      placeholder="spotify-disco-ball"
                      className="h-8 text-xs font-mono"
                      disabled={createCustomMutation.isPending}
                    />
                    <Button
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={handleCreateCustom}
                      disabled={!slugInput || !!slugError || createCustomMutation.isPending}
                    >
                      {createCustomMutation.isPending && (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      )}
                      Create
                    </Button>
                  </div>
                  {slugInput && !slugError && (
                    <p className="text-xs text-muted-foreground font-mono break-all">
                      {previewOrigin}/shared/{slugInput}
                    </p>
                  )}
                  {slugError && (
                    <p className="text-xs text-destructive">{slugError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Replaces any previous custom link for this dashboard. The standard link above keeps working.
                  </p>
                </div>
              )}
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
