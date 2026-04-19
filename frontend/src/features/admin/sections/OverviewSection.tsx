import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { Users, MessageSquare, Database, FileText, DollarSign, Coins } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { getAdminOverview, getAdminActivity } from '../../../api/endpoints/admin.ts';

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-vibrant/10">
            <Icon className="h-5 w-5 text-accent-vibrant" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

// Pivot activity points from [{date, event_type, count}] to [{date, chat_message: N, ...}]
function pivotActivity(points: { date: string; event_type: string; count: number }[]) {
  const map = new Map<string, Record<string, number>>();
  for (const p of points) {
    if (!map.has(p.date)) map.set(p.date, {});
    const row = map.get(p.date)!;
    row[p.event_type] = (row[p.event_type] || 0) + p.count;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      Queries: counts.chat_message || 0,
      Collections: counts.collection_created || 0,
      'Posts Collected': counts.posts_collected || 0,
      'Tool Calls': counts.tool_call || 0,
    }));
}

const CHART_COLORS = {
  Queries: 'var(--primary)',
  Collections: 'var(--chart-2)',
  'Posts Collected': 'var(--chart-3)',
  'Tool Calls': 'var(--chart-4)',
};

export function OverviewSection() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getAdminOverview,
  });

  const { data: activity } = useQuery({
    queryKey: ['admin', 'activity', 30],
    queryFn: () => getAdminActivity(30),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const chartData = activity ? pivotActivity(activity.points) : [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard title="Total Users" value={overview?.total_users ?? 0} icon={Users} />
        <StatCard
          title="Active Users (30d)"
          value={overview?.active_users_30d ?? 0}
          icon={Users}
          subtitle={overview ? `${Math.round(((overview.active_users_30d || 0) / Math.max(overview.total_users, 1)) * 100)}% of total` : undefined}
        />
        <StatCard title="Total Queries" value={(overview?.total_queries ?? 0).toLocaleString()} icon={MessageSquare} />
        <StatCard title="Total Collections" value={overview?.total_collections ?? 0} icon={Database} />
        <StatCard title="Total Posts" value={(overview?.total_posts ?? 0).toLocaleString()} icon={FileText} />
        <StatCard
          title="Revenue"
          value={formatCents(overview?.total_revenue_cents ?? 0)}
          icon={DollarSign}
        />
        <StatCard
          title="Credits Purchased"
          value={(overview?.total_credits_purchased ?? 0).toLocaleString()}
          icon={Coins}
        />
        <StatCard
          title="Credits Outstanding"
          value={(overview?.credits_outstanding ?? 0).toLocaleString()}
          icon={Coins}
          subtitle="Across all users & orgs"
        />
        <StatCard title="Organizations" value={overview?.total_orgs ?? 0} icon={Users} />
      </div>

      {/* Activity Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">Daily Activity (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
                {Object.entries(CHART_COLORS).map(([key, color]) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.1}
                    stackId="1"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
