import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { VolumeOverTime } from '../../../api/types.ts';

interface VolumeChartProps {
  data: VolumeOverTime[];
}

export function VolumeChart({ data }: VolumeChartProps) {
  // Aggregate by date (sum across platforms)
  const byDate = data.reduce<Record<string, number>>((acc, item) => {
    acc[item.post_date] = (acc[item.post_date] || 0) + item.post_count;
    return acc;
  }, {});

  const chartData = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={chartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
        <YAxis tick={{ fontSize: 10 }} width={30} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#4338CA"
          fill="#EEF2FF"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
