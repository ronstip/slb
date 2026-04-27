import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';
import type { EngagementRatePoint } from '../dashboard/dashboard-aggregations.ts';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface EngagementRateChartProps {
  data: EngagementRatePoint[];
  tickFormatter?: (d: string) => string;
}

const defaultDayTick = (d: string) => {
  const parts = d.split('-');
  return `${MONTHS[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
};

export function EngagementRateChart({ data, tickFormatter }: EngagementRateChartProps) {
  const chartColors = useChartColors();
  const color = chartColors[2] || chartColors[0];

  const chartConfig: ChartConfig = {
    rate: { label: 'Engagement Rate', color },
  };

  if (data.length === 0) return null;

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-engagement" x1="0" y1="0" x2="0" y2="1">
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
          tickFormatter={(v: number) => `${v.toFixed(1)}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
                const payload = item.payload as EngagementRatePoint;
                return (
                  <span>
                    {Number(value).toFixed(2)}%
                    <span className="ml-2 text-muted-foreground">
                      ({formatNumber(payload.total_engagement)} eng / {formatNumber(payload.total_views)} views)
                    </span>
                  </span>
                );
              }}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="rate"
          stroke={color}
          strokeWidth={2}
          fill="url(#grad-engagement)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
