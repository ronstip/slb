import { BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { ThemeDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface ThemeBarProps {
  data: ThemeDistribution[];
  overrides?: ChartOverrides;
  onBarClick?: (theme: string) => void;
  activeFilters?: string[];
}

export function ThemeBar({ data, overrides, onBarClick, activeFilters }: ThemeBarProps) {
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
      <BarChart
        accessibilityLayer
        data={top10}
        layout="vertical"
        margin={{ left: 0, right: 56 }}
        onClick={(state) => {
          if (onBarClick && state?.activePayload?.[0]) {
            onBarClick(state.activePayload[0].payload.theme);
          }
        }}
        className={onBarClick ? 'cursor-pointer' : ''}
      >
        <defs>
          <linearGradient id="grad-theme" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={barColor} stopOpacity={0.6} />
            <stop offset="100%" stopColor={barColor} stopOpacity={1} />
          </linearGradient>
        </defs>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="theme"
          width={100}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="post_count"
          fill="url(#grad-theme)"
          radius={[0, 6, 6, 0]}
          maxBarSize={24}
          fillOpacity={activeFilters?.length ? 0.3 : 0.85}
        >
          <LabelList dataKey="label" position="right" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
