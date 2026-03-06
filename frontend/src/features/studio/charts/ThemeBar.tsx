import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { ThemeDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface ThemeBarProps {
  data: ThemeDistribution[];
  overrides?: ChartOverrides;
}

export function ThemeBar({ data, overrides }: ThemeBarProps) {
  const chartColors = useChartColors();
  const barColor = overrides?.colorOverrides?.['bar'] || chartColors[0];

  const total = data.reduce((sum, d) => sum + d.post_count, 0);
  const top10 = data.slice(0, 10).map((d) => ({
    ...d,
    label: `${d.post_count}${total > 0 ? ` (${Math.round((d.post_count / total) * 100)}%)` : ''}`,
  }));

  const chartConfig: ChartConfig = {
    post_count: { label: 'Posts', color: barColor },
  };

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ minHeight: Math.max(150, top10.length * 36) }}>
      <BarChart accessibilityLayer data={top10} layout="vertical" margin={{ left: 0, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          type="category"
          dataKey="theme"
          width={110}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="post_count" fill="var(--color-post_count)" radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="label" position="right" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
