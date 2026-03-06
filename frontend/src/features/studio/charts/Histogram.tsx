import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface HistogramBucket {
  bucket: string;
  count: number;
}

interface HistogramProps {
  data: HistogramBucket[];
  overrides?: ChartOverrides;
}

export function Histogram({ data, overrides }: HistogramProps) {
  const chartColors = useChartColors();
  const barColor = overrides?.colorOverrides?.['bar'] || chartColors[0];

  const chartConfig: ChartConfig = {
    count: { label: 'Count', color: barColor },
  };

  return (
    <ChartContainer config={chartConfig} className="min-h-[180px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={40}
          tickFormatter={formatNumber}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4}>
          {overrides?.showValues && (
            <LabelList dataKey="count" position="top" style={{ fontSize: 9 }} />
          )}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
