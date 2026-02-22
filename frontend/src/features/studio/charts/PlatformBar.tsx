import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface PlatformBarProps {
  data: Array<{ platform: string; post_count: number }>;
  overrides?: ChartOverrides;
}

export function PlatformBar({ data, overrides }: PlatformBarProps) {
  const chartData = data.map((d) => ({
    name: PLATFORM_LABELS[d.platform] || d.platform,
    posts: d.post_count,
    platform: d.platform,
  }));

  const getColor = (platform: string) =>
    overrides?.colorOverrides?.[platform] || PLATFORM_COLORS[platform] || '#78716C';

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 28)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={70}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={(value) => [value, 'Posts']}
        />
        <Bar dataKey="posts" radius={[0, 2, 2, 0]} barSize={16}>
          {chartData.map((entry) => (
            <Cell key={entry.platform} fill={getColor(entry.platform)} />
          ))}
          {overrides?.showValues && (
            <LabelList dataKey="posts" position="right" style={{ fontSize: 10 }} />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
