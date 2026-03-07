import { PieChart, Pie, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { ContentTypeBreakdown } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface ContentTypeDonutProps {
  data: ContentTypeBreakdown[];
  overrides?: ChartOverrides;
}

const chartConfig: ChartConfig = {
  percentage: { label: 'Share' },
};

const RADIAN = Math.PI / 180;
function renderPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function ContentTypeDonut({ data, overrides }: ContentTypeDonutProps) {
  const chartColors = useChartColors();

  const getColor = (contentType: string, index: number) =>
    overrides?.colorOverrides?.[contentType] || chartColors[index % chartColors.length];

  return (
    <div className="flex items-center gap-6">
      <ChartContainer config={chartConfig} className="h-[200px] w-[200px]">
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="content_type"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={88}
            strokeWidth={2}
            stroke="var(--background)"
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.content_type, i)} />
            ))}
          </Pie>
          <ChartTooltip
            content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex flex-col gap-2">
        {data.slice(0, 6).map((item, i) => (
          <div key={item.content_type} className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.content_type, i) }}
            />
            <span className="text-[11px] capitalize text-muted-foreground">
              {item.content_type}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
              {overrides?.showValues && item.count != null && (
                <span className="ml-1 font-medium text-foreground/70">{item.count}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
