import { BarChart, Bar, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

const chartConfig: ChartConfig = {
  posts: { label: 'Posts' },
};

interface PlatformBarProps {
  data: Array<{ platform: string; post_count: number }>;
  overrides?: ChartOverrides;
}

export function PlatformBar({ data, overrides }: PlatformBarProps) {
  const total = data.reduce((sum, d) => sum + d.post_count, 0);
  const chartData = data.map((d) => ({
    name: PLATFORM_LABELS[d.platform] || d.platform,
    posts: d.post_count,
    platform: d.platform,
    label: `${d.post_count}${total > 0 ? ` (${Math.round((d.post_count / total) * 100)}%)` : ''}`,
  }));

  const getColor = (platform: string) =>
    overrides?.colorOverrides?.[platform] || PLATFORM_COLORS[platform] || '#78716C';

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ minHeight: Math.max(140, chartData.length * 36) }}>
      <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 0, right: 12 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="posts" radius={4} maxBarSize={28}>
          {chartData.map((entry) => (
            <Cell key={entry.platform} fill={getColor(entry.platform)} />
          ))}
          <LabelList dataKey="label" position="right" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
