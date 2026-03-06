import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

const chartConfig: ChartConfig = {
  percentage: { label: 'Percentage' },
};

interface SentimentBarProps {
  data: SentimentBreakdown[];
  overrides?: ChartOverrides;
}

function resolveSentimentColor(sentiment: string): string {
  const lower = sentiment.toLowerCase();
  return SENTIMENT_COLORS[lower]
    ?? Object.entries(SENTIMENT_COLORS).find(([key]) => lower.startsWith(key))?.[1]
    ?? '#78716C';
}

export function SentimentBar({ data, overrides }: SentimentBarProps) {
  const getColor = (sentiment: string) =>
    overrides?.colorOverrides?.[sentiment] || resolveSentimentColor(sentiment);

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ minHeight: Math.max(120, data.length * 32) }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => `${v}%`} />
        <YAxis
          type="category"
          dataKey="sentiment"
          width={70}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="capitalize"
        />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />}
        />
        <Bar dataKey="percentage" radius={4}>
          {data.map((entry) => (
            <Cell key={entry.sentiment} fill={getColor(entry.sentiment)} />
          ))}
          {overrides?.showValues && (
            <LabelList dataKey="percentage" position="right" formatter={(v: number) => `${Number(v).toFixed(0)}%`} style={{ fontSize: 10 }} />
          )}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
