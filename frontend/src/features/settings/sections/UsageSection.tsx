import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth.ts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Progress } from '../../../components/ui/progress.tsx';
import { Database, FileText, MessageSquare } from 'lucide-react';
import type { UsageStats, UsageTrendPoint } from '../../../api/types.ts';
import { getUsage, getOrgUsage, getUsageTrend, getOrgUsageTrend } from '../../../api/endpoints/settings.ts';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

export function UsageSection() {
  const { profile } = useAuth();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [orgUsage, setOrgUsage] = useState<UsageStats | null>(null);
  const [trendData, setTrendData] = useState<UsageTrendPoint[]>([]);
  const [orgTrendData, setOrgTrendData] = useState<UsageTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const isOrg = !!profile?.org_id;
  const isAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin';

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [userUsage, orgData, trend, orgTrend] = await Promise.all([
          getUsage(),
          isOrg && isAdmin ? getOrgUsage().catch(() => null) : Promise.resolve(null),
          getUsageTrend(30).catch(() => ({ points: [], granularity: 'daily' })),
          isOrg && isAdmin ? getOrgUsageTrend(30).catch(() => ({ points: [], granularity: 'daily' })) : Promise.resolve({ points: [], granularity: 'daily' }),
        ]);
        setUsage(userUsage);
        setOrgUsage(orgData);
        setTrendData(trend.points);
        setOrgTrendData(orgTrend.points);
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </CardContent>
      </Card>
    );
  }

  const statsToShow = orgUsage || usage;
  if (!statsToShow) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No usage data available yet. Start by creating a collection.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Billing Period</CardTitle>
          <CardDescription>
            {new Date(statsToShow.period_start).toLocaleDateString()} — {new Date(statsToShow.period_end).toLocaleDateString()}
            {orgUsage && ' (Organization)'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <UsageMetric
            icon={MessageSquare}
            label="Queries"
            used={statsToShow.queries_used}
            limit={statsToShow.queries_limit}
          />
          <UsageMetric
            icon={FileText}
            label="Collections"
            used={statsToShow.collections_created}
            limit={statsToShow.collections_limit}
          />
          <UsageMetric
            icon={Database}
            label="Posts Collected"
            used={statsToShow.posts_collected}
            limit={statsToShow.posts_limit}
          />
        </CardContent>
      </Card>

      {/* Personal usage when showing org */}
      {orgUsage && usage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Personal Usage</CardTitle>
            <CardDescription>Your individual contribution this period.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <UsageMetric
              icon={MessageSquare}
              label="Queries"
              used={usage.queries_used}
              limit={usage.queries_limit}
            />
            <UsageMetric
              icon={FileText}
              label="Collections"
              used={usage.collections_created}
              limit={usage.collections_limit}
            />
            <UsageMetric
              icon={Database}
              label="Posts Collected"
              used={usage.posts_collected}
              limit={usage.posts_limit}
            />
          </CardContent>
        </Card>
      )}

      {/* Personal Trend Chart */}
      <UsageTrendChart
        title="Your Usage Trend"
        description="Daily usage over the last 30 days"
        data={trendData}
      />

      {/* Org Trend Chart (split by user) */}
      {isOrg && isAdmin && orgTrendData.length > 0 && (
        <OrgUsageTrendChart
          title="Organization Usage by Member"
          description="Daily usage split by team members"
          data={orgTrendData}
        />
      )}
    </div>
  );
}

function UsageMetric({
  icon: Icon,
  label,
  used,
  limit,
}: {
  icon: React.ElementType;
  label: string;
  used: number;
  limit: number;
}) {
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isUnlimited = limit === -1;
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isAtLimit = !isUnlimited && percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className={`text-sm font-mono ${isAtLimit ? 'text-destructive' : isNearLimit ? 'text-yellow-600' : 'text-muted-foreground'}`}>
          {used.toLocaleString()} / {isUnlimited ? 'Unlimited' : limit.toLocaleString()}
        </span>
      </div>
      {!isUnlimited && (
        <Progress
          value={percentage}
          className={`h-2 ${isAtLimit ? '[&>div]:bg-destructive' : isNearLimit ? '[&>div]:bg-yellow-500' : ''}`}
        />
      )}
    </div>
  );
}

function UsageTrendChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: UsageTrendPoint[];
}) {
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Queries: d.queries,
    Posts: d.posts,
    Collections: d.collections,
  }));

  const hasData = chartData.some((d) => d.Queries > 0 || d.Posts > 0 || d.Collections > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No trend data yet. Usage will appear here as you use the platform.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(160 60% 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(160 60% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="Queries"
                stroke="hsl(var(--primary))"
                fill="url(#colorQueries)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="Posts"
                stroke="hsl(160 60% 45%)"
                fill="url(#colorPosts)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function OrgUsageTrendChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: UsageTrendPoint[];
}) {
  const userNames = [...new Set(data.map((d) => d.user_name).filter(Boolean))] as string[];

  const dateMap = new Map<string, Record<string, number>>();
  for (const d of data) {
    const dateLabel = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!dateMap.has(dateLabel)) {
      dateMap.set(dateLabel, {});
    }
    const row = dateMap.get(dateLabel)!;
    const name = d.user_name || 'Unknown';
    row[name] = (row[name] || 0) + d.queries + d.posts;
  }

  const chartData = [...dateMap.entries()].map(([date, vals]) => ({
    date,
    ...vals,
  }));

  const COLORS = [
    'hsl(var(--primary))',
    'hsl(160 60% 45%)',
    'hsl(30 80% 55%)',
    'hsl(280 65% 60%)',
    'hsl(340 75% 55%)',
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                borderColor: 'hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {userNames.map((name, i) => (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stackId="1"
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
