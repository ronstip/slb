import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { cn } from '../../../lib/utils.ts';
import { getAdminCollections } from '../../../api/endpoints/admin.ts';

const STATUS_FILTERS = ['', 'running', 'success', 'failed'];

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  success: 'bg-green-500/10 text-green-700 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

export function CollectionsSection() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'collections', statusFilter],
    queryFn: () =>
      getAdminCollections({
        limit: '100',
        ...(statusFilter ? { status_filter: statusFilter } : {}),
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s || 'all'}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className={cn(statusFilter === s && 'pointer-events-none')}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        {data?.total ?? 0} collections
      </p>

      {/* Table */}
      <div className="rounded-md border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Platforms</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Posts</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Enriched</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {(data?.collections ?? []).map((c) => (
                <tr key={c.collection_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.collection_id.slice(0, 8)}...
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-foreground">{c.user_email || c.user_id.slice(0, 8)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="secondary"
                      className={cn('text-xs', STATUS_COLORS[c.status] || '')}
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {c.platforms.map((p) => (
                        <Badge key={p} variant="outline" className="text-xs">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{c.posts_collected.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.posts_enriched.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
              {(data?.collections ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No collections found
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
