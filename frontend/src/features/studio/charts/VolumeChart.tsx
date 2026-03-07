import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';
import type { VolumeOverTime } from '../../../api/types.ts';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface VolumeChartProps {
  data: VolumeOverTime[];
}

export function VolumeChart({ data }: VolumeChartProps) {
  const chartColors = useChartColors();

  const chartConfig: ChartConfig = {
    count: { label: 'Posts', color: chartColors[0] },
  };

  const byDate = data.reduce<Record<string, number>>((acc, item) => {
    acc[item.post_date] = (acc[item.post_date] || 0) + item.post_count;
    return acc;
  }, {});

  const chartData = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 10 }}
          tickFormatter={(d: string) => {
            const parts = d.split('-');
            return `${MONTHS[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tick={{ fontSize: 10 }}
          tickFormatter={formatNumber}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} fillOpacity={0.9} />
      </BarChart>
    </ChartContainer>
  );
}
