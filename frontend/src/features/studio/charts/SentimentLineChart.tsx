import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { SentimentTimePoint } from '../dashboard/dashboard-aggregations.ts';

const SERIES = ['positive', 'negative', 'neutral', 'mixed'] as const;

const chartConfig: ChartConfig = {
  positive: { label: 'Positive', color: SENTIMENT_COLORS.positive },
  negative: { label: 'Negative', color: SENTIMENT_COLORS.negative },
  neutral:  { label: 'Neutral',  color: SENTIMENT_COLORS.neutral },
  mixed:    { label: 'Mixed',    color: SENTIMENT_COLORS.mixed },
};

interface SentimentLineChartProps {
  data: SentimentTimePoint[];
}

export function SentimentLineChart({ data }: SentimentLineChartProps) {
  if (data.length === 0) return null;

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <defs>
          {SERIES.map((key) => (
            <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SENTIMENT_COLORS[key]} stopOpacity={0.25} />
              <stop offset="95%" stopColor={SENTIMENT_COLORS[key]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 10 }}
          tickFormatter={(d: string) => {
            const parts = d.split('-');
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={28}
          tick={{ fontSize: 10 }}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {SERIES.map((key) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={SENTIMENT_COLORS[key]}
            strokeWidth={2}
            fill={`url(#grad-${key})`}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
