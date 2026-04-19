import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { ArrowLeft, Mail, Calendar, Shield } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { getAdminUserDetail } from '../../../api/endpoints/admin.ts';

interface UserDetailSectionProps {
  userId: string;
  onBack: () => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  chat_message: 'Chat Message',
  collection_created: 'Collection Created',
  posts_collected: 'Posts Collected',
  tool_call: 'Tool Call',
  credit_purchase: 'Credit Purchase',
};

export function UserDetailSection({ userId, onBack }: UserDetailSectionProps) {
  const { data: user, isLoading } = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => getAdminUserDetail(userId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        User not found
      </div>
    );
  }

  const trendData = (user.usage_trend || []).map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Queries: d.queries,
    Collections: d.collections,
    Posts: d.posts,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            {user.display_name || user.email}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      {/* Profile + Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span className="text-xs">Email</span>
            </div>
            <p className="mt-1 text-sm font-medium truncate">{user.email}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">Joined</span>
            </div>
            <p className="mt-1 text-sm font-medium">
              {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span className="text-xs">Role</span>
            </div>
            <p className="mt-1 text-sm font-medium">
              {user.org_role || 'No org'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Credits</p>
            <p className="mt-1 text-xl font-bold">{user.credits_remaining}</p>
          </CardContent>
        </Card>
      </div>

      {/* Usage Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{user.queries_used}</p>
            <p className="text-xs text-muted-foreground">Queries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{user.collections_created}</p>
            <p className="text-xs text-muted-foreground">Collections</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{user.posts_collected.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Posts Collected</p>
          </CardContent>
        </Card>
      </div>

      {/* Usage Trend Chart */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">Usage Trend (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Queries" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.1} />
                <Area type="monotone" dataKey="Collections" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.1} />
                <Area type="monotone" dataKey="Posts" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(user.recent_events || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {user.recent_events.slice(0, 30).map((event) => (
                <div
                  key={event.event_id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-xs">
                      {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
                    </Badge>
                    {event.collection_id && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {event.collection_id.slice(0, 8)}...
                      </span>
                    )}
                    {event.metadata && typeof event.metadata === 'object' && (
                      <span className="text-xs text-muted-foreground">
                        {(event.metadata as Record<string, unknown>).tool_name as string || ''}
                        {(event.metadata as Record<string, unknown>).count
                          ? ` (${(event.metadata as Record<string, unknown>).count} posts)`
                          : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
