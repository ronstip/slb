import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { cn } from '../../../lib/utils.ts';
import { getAdminRevenue } from '../../../api/endpoints/admin.ts';

const RANGE_OPTIONS = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export function RevenueSection() {
  const [days, setDays] = useState(90);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'revenue', days],
    queryFn: () => getAdminRevenue(days),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const chartData = (data?.daily_revenue || []).map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Revenue: d.revenue_cents / 100,
    Purchases: d.purchases,
  }));

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

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {formatCents(data?.total_revenue_cents ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Revenue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{data?.total_purchases ?? 0}</p>
            <p className="text-xs text-muted-foreground">Purchases</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {formatCents(data?.avg_purchase_cents ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Avg Purchase</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: 12,
                  }}
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
                />
                <Bar dataKey="Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Purchases */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">Recent Purchases</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.recent_purchases || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases yet</p>
          ) : (
            <div className="rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Credits</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recent_purchases.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.purchased_at ? new Date(p.purchased_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-2">{p.purchased_by_name || p.purchased_by || '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.credits}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCents(p.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
