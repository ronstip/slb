import { PieChart, Pie, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface SentimentPieProps {
  data: SentimentBreakdown[];
  overrides?: ChartOverrides;
}

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

function resolveSentimentColor(sentiment: string): string {
  const lower = sentiment.toLowerCase();
  return SENTIMENT_COLORS[lower]
    ?? Object.entries(SENTIMENT_COLORS).find(([key]) => lower.startsWith(key))?.[1]
    ?? '#78716C';
}

export function SentimentPie({ data, overrides }: SentimentPieProps) {
  const getColor = (sentiment: string) =>
    overrides?.colorOverrides?.[sentiment] || resolveSentimentColor(sentiment);

  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((d) => [d.sentiment, { label: d.sentiment.charAt(0).toUpperCase() + d.sentiment.slice(1), color: getColor(d.sentiment) }]),
  );

  return (
    <div className="flex items-center justify-center gap-6">
      <ChartContainer config={chartConfig} className="h-[200px] w-[200px] shrink-0">
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="sentiment"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={88}
            strokeWidth={2}
            stroke="var(--background)"
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.sentiment} fill={getColor(entry.sentiment)} />
            ))}
          </Pie>
          <ChartTooltip
            content={<ChartTooltipContent nameKey="sentiment" hideLabel />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex flex-col gap-2">
        {data.map((item) => (
          <div key={item.sentiment} className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.sentiment) }}
            />
            <span className="text-[11px] capitalize text-muted-foreground">
              {item.sentiment}
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
