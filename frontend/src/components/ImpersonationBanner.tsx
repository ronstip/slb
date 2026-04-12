import { useQueryClient } from '@tanstack/react-query';
import { X, Eye } from 'lucide-react';

import { Button } from './ui/button.tsx';
import { useAuth } from '../auth/useAuth.ts';
import { useImpersonationStore } from '../stores/impersonation-store.ts';
import { stopImpersonation } from '../lib/impersonation.ts';

/**
 * Fixed top bar that appears when a super admin is viewing the app as
 * another user. Provides an obvious exit control so the admin can't
 * forget they're impersonating.
 *
 * Reads the target label from the impersonation store (instant) and
 * falls back to `profile.impersonation` (authoritative, from `/me`).
 */
export function ImpersonationBanner() {
  const queryClient = useQueryClient();
  const { profile, refreshProfile } = useAuth();
  const targetUid = useImpersonationStore((s) => s.targetUid);
  const targetEmail = useImpersonationStore((s) => s.targetEmail);
  const targetDisplayName = useImpersonationStore((s) => s.targetDisplayName);

  if (!targetUid) return null;

  const displayName =
    profile?.impersonation?.target_display_name ||
    targetDisplayName ||
    profile?.impersonation?.target_email ||
    targetEmail ||
    targetUid;
  const email =
    profile?.impersonation?.target_email || targetEmail || '';

  const handleExit = async () => {
    try {
      await stopImpersonation(queryClient, refreshProfile);
    } catch {
      // stopImpersonation already swallows API errors; nothing to surface.
    }
  };

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-amber-600/40 bg-amber-500/95 px-4 py-2 text-amber-950 shadow-sm dark:bg-amber-500 dark:text-amber-950">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Viewing as <strong>{displayName}</strong>
          {email && email !== displayName && (
            <span className="ml-1 opacity-80">({email})</span>
          )}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleExit}
        className="h-7 border-amber-900/30 bg-amber-50 text-amber-950 hover:bg-amber-100"
      >
        <X className="mr-1 h-3.5 w-3.5" />
        Exit
      </Button>
    </div>
  );
}
