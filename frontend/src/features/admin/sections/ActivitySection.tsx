import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { cn } from '../../../lib/utils.ts';
import { getAdminActivity } from '../../../api/endpoints/admin.ts';

const RANGE_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const EVENT_COLORS: Record<string, string> = {
  'Queries': 'var(--primary)',
  'Collections': 'var(--chart-2)',
  'Posts Collected': 'var(--chart-3)',
  'Tool Calls': 'var(--chart-4)',
  'Credit Purchases': 'var(--chart-5)',
};

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
      'Credit Purchases': counts.credit_purchase || 0,
    }));
}

export function ActivitySection() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'activity', days],
    queryFn: () => getAdminActivity(days),
  });

  const chartData = data ? pivotActivity(data.points) : [];

  // Compute totals from raw points
  const totals: Record<string, number> = {};
  for (const p of data?.points || []) {
    const label =
      p.event_type === 'chat_message' ? 'Queries' :
      p.event_type === 'collection_created' ? 'Collections' :
      p.event_type === 'posts_collected' ? 'Posts Collected' :
      p.event_type === 'tool_call' ? 'Tool Calls' :
      p.event_type === 'credit_purchase' ? 'Credit Purchases' :
      p.event_type;
    totals[label] = (totals[label] || 0) + p.count;
  }

  return (
    <div className="space-y-6">
      {/* Range Selector */}
      <div className="flex gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={days === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDays(opt.value)}
            className={cn(days === opt.value && 'pointer-events-none')}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Object.entries(totals).map(([label, count]) => (
          <Card key={label}>
            <CardContent className="p-3 text-center">
              <p className="text-lg font-bold">{count.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : chartData.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">Activity Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
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
                {Object.entries(EVENT_COLORS).map(([key, color]) => (
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
      ) : (
        <p className="text-center py-12 text-muted-foreground">No activity data yet</p>
      )}
    </div>
  );
}
