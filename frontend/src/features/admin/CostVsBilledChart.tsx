import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

interface Point {
  date: string;
  cost_micros: number;
  billed_micros: number;
}

interface Props {
  data: Point[];
  height?: number;
}

/** Shared area chart used by FinanceSection (platform-wide) + UserDetailSection
 *  (per-user). Returns null when the series is empty / all-zero so the parent
 *  can hide the card entirely. Recharts handles the axes & legend; we only
 *  format the dates and convert micros → dollars at the boundary.
 *
 *  Series names ("Cost" / "Billed") match the tooltips on the Finance
 *  breakdown headers so the same vocabulary is used everywhere.
 */
export function CostVsBilledChart({ data, height = 300 }: Props) {
  const series = data.map((p) => ({
    date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Cost: p.cost_micros / 1_000_000,
    Billed: p.billed_micros / 1_000_000,
  }));

  if (series.length === 0 || series.every((d) => d.Cost === 0 && d.Billed === 0)) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
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
          formatter={(value: number | string) => `$${Number(value).toFixed(2)}`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="Billed" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.12} />
        <Area type="monotone" dataKey="Cost" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
