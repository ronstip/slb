import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Input } from '../../components/ui/input.tsx';
import { getAdminUsers } from '../../api/endpoints/admin.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { startImpersonation } from '../../lib/impersonation.ts';

interface ImpersonateUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImpersonateUserModal({ open, onOpenChange }: ImpersonateUserModalProps) {
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { refreshProfile } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', 'impersonate-picker'],
    queryFn: () =>
      getAdminUsers({
        limit: '500',
        sort_by: 'last_login_at',
        order: 'desc',
        exclude_super_admins: 'true',
      }),
    enabled: open,
  });

  const searchLower = search.trim().toLowerCase();
  const users = (data?.users ?? []).filter((u) => {
    if (!searchLower) return true;
    return (
      (u.email || '').toLowerCase().includes(searchLower) ||
      (u.display_name || '').toLowerCase().includes(searchLower)
    );
  });

  const handleSelect = async (uid: string, email: string, displayName: string | null) => {
    setSubmitting(uid);
    setError(null);
    try {
      await startImpersonation(
        queryClient,
        { uid, email, displayName },
        refreshProfile,
      );
      onOpenChange(false);
      setSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start impersonation');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-tight">View as User</DialogTitle>
          <DialogDescription>
            See the app exactly as the selected user sees it. Everything you do
            will be performed as that user until you exit. Super admins are
            hidden from this list.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            </div>
          ) : users.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No users found
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {users.map((u) => (
                <li key={u.uid}>
                  <button
                    type="button"
                    disabled={submitting !== null}
                    onClick={() => handleSelect(u.uid, u.email, u.display_name)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {u.photo_url ? (
                      <img
                        src={u.photo_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <UserCircle className="h-8 w-8 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {u.display_name || u.email}
                      </div>
                      {u.display_name && (
                        <div className="truncate text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      )}
                    </div>
                    {submitting === u.uid && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
