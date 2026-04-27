import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';
import type { VolumeOverTime } from '../../../api/types.ts';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface VolumeChartProps {
  data: VolumeOverTime[];
  tickFormatter?: (d: string) => string;
}

const defaultDayTick = (d: string) => {
  const parts = d.split('-');
  return `${MONTHS[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
};

export function VolumeChart({ data, tickFormatter }: VolumeChartProps) {
  const chartColors = useChartColors();
  const color = chartColors[0];

  const chartConfig: ChartConfig = {
    count: { label: 'Posts', color },
  };

  const byDate = data.reduce<Record<string, number>>((acc, item) => {
    acc[item.post_date] = (acc[item.post_date] || 0) + item.post_count;
    return acc;
  }, {});

  const chartData = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (chartData.length === 0) return null;

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <AreaChart accessibilityLayer data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-volume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 10 }}
          tickFormatter={tickFormatter ?? defaultDayTick}
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
        <Area
          type="monotone"
          dataKey="count"
          stroke={color}
          strokeWidth={2}
          fill="url(#grad-volume)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
