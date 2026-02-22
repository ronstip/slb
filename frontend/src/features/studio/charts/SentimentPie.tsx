import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
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

export function SentimentPie({ data, overrides }: SentimentPieProps) {
  const getColor = (sentiment: string) =>
    overrides?.colorOverrides?.[sentiment] || SENTIMENT_COLORS[sentiment] || '#78716C';

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="sentiment"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.sentiment} fill={getColor(entry.sentiment)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            contentStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1">
        {data.map((item) => (
          <div key={item.sentiment} className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: getColor(item.sentiment) }}
            />
            <span className="text-xs capitalize text-muted-foreground">
              {item.sentiment} ({item.percentage.toFixed(0)}%)
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
