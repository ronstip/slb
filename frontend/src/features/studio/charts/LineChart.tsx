import { LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';
import type { VolumeOverTime } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface LineChartProps {
  data: VolumeOverTime[];
  overrides?: ChartOverrides;
}

export function LineChart({ data, overrides }: LineChartProps) {
  const chartColors = useChartColors();
  const lineColor = overrides?.colorOverrides?.['line'] || chartColors[0];

  const chartConfig: ChartConfig = {
    count: { label: 'Posts', color: lineColor },
  };

  const byDate = data.reduce<Record<string, number>>((acc, item) => {
    acc[item.post_date] = (acc[item.post_date] || 0) + item.post_count;
    return acc;
  }, {});

  const chartData = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ChartContainer config={chartConfig} className="min-h-[180px] w-full">
      <ReLineChart accessibilityLayer data={chartData} margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(d) => d.slice(5)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tickFormatter={formatNumber}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey="count"
          stroke="var(--color-count)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ReLineChart>
    </ChartContainer>
  );
}
