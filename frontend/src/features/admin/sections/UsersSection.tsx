import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUpDown } from 'lucide-react';
import { Input } from '../../../components/ui/input.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { getAdminUsers } from '../../../api/endpoints/admin.ts';

interface UsersSectionProps {
  onSelectUser: (userId: string) => void;
}

export function UsersSection({ onSelectUser }: UsersSectionProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', sortBy, order, search],
    queryFn: () =>
      getAdminUsers({
        sort_by: sortBy,
        order,
        limit: '200',
        search,
      }),
  });

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setOrder(order === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setOrder('desc');
    }
  };

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
      <button
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => handleSort(field)}
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {data?.total ?? 0} users
      </p>

      {/* Table */}
      <div className="rounded-md border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <SortHeader field="email">Email</SortHeader>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Org
                </th>
                <SortHeader field="queries_used">Queries</SortHeader>
                <SortHeader field="collections_created">Collections</SortHeader>
                <SortHeader field="posts_collected">Posts</SortHeader>
                <SortHeader field="created_at">Joined</SortHeader>
                <SortHeader field="last_login_at">Last Active</SortHeader>
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr
                  key={u.uid}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => onSelectUser(u.uid)}
                >
                  <td className="px-3 py-2">
                    <div>
                      <span className="font-medium text-foreground">
                        {u.display_name || u.email}
                      </span>
                      {u.display_name && (
                        <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {u.org_role && (
                      <Badge variant="secondary" className="text-xs">
                        {u.org_role}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{u.queries_used}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.collections_created}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.posts_collected.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
              {(data?.users ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No users found
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
