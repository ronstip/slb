import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ArrowUpDown, Trash2, Copy, Check } from 'lucide-react';
import { Input } from '../../../components/ui/input.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import {
  getAdminWaitlist,
  deleteAdminWaitlistEntry,
} from '../../../api/endpoints/admin.ts';

type SortField = 'created_at' | 'updated_at' | 'email' | 'submission_count';

export function WaitlistSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'waitlist', sortBy, order, search],
    queryFn: () =>
      getAdminWaitlist({
        sort_by: sortBy,
        order,
        limit: '1000',
        search,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (entryId: string) => deleteAdminWaitlistEntry(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'waitlist'] });
    },
  });

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setOrder(order === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setOrder('desc');
    }
  };

  const handleCopyEmails = async () => {
    const emails = (data?.entries ?? []).map((e) => e.email).join(', ');
    if (!emails) return;
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  };

  const handleDelete = (entryId: string, email: string) => {
    if (!window.confirm(`Remove ${email} from the waitlist?`)) return;
    deleteMut.mutate(entryId);
  };

  const SortHeader = ({ field, children, align }: {
    field: SortField; children: React.ReactNode; align?: 'right';
  }) => (
    <th className={`px-3 py-2 text-xs font-medium text-muted-foreground ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        className={`flex items-center gap-1 hover:text-foreground ${align === 'right' ? 'ml-auto' : ''}`}
        onClick={() => handleSort(field)}
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  const totalSubmissions = useMemo(
    () => (data?.entries ?? []).reduce((acc, e) => acc + (e.submission_count ?? 1), 0),
    [data?.entries],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      {/* Header row: search + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email, name, or interest…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyEmails}
          disabled={entries.length === 0}
        >
          {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
          {copied ? 'Copied' : 'Copy emails'}
        </Button>
      </div>

      {/* Counts */}
      <p className="text-sm text-muted-foreground">
        {data?.total ?? 0} signups
        {totalSubmissions > (data?.total ?? 0) && (
          <span className="ml-2 text-xs">· {totalSubmissions} total submissions (some signed up more than once)</span>
        )}
      </p>

      {/* Table */}
      <div className="rounded-md border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <SortHeader field="email">Email</SortHeader>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Interested in</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                <SortHeader field="submission_count" align="right">Submits</SortHeader>
                <SortHeader field="created_at">Joined</SortHeader>
                <SortHeader field="updated_at">Last activity</SortHeader>
                <th className="w-12 px-3 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{e.email}</span>
                      {e.display_name && (
                        <span className="text-xs text-muted-foreground">{e.display_name}</span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    {e.interested_in ? (
                      <span
                        className="line-clamp-2 text-foreground/90"
                        title={e.interested_in}
                      >
                        {e.interested_in}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.source && (
                      <Badge variant="secondary" className="text-xs">{e.source}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{e.submission_count ?? 1}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {e.updated_at ? new Date(e.updated_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(e.id, e.email)}
                      disabled={deleteMut.isPending}
                      aria-label={`Remove ${e.email}`}
                      title="Remove from waitlist"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No waitlist signups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
