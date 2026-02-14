import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';

interface SentimentPieProps {
  data: SentimentBreakdown[];
}

export function SentimentPie({ data }: SentimentPieProps) {
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
          >
            {data.map((entry) => (
              <Cell
                key={entry.sentiment}
                fill={SENTIMENT_COLORS[entry.sentiment] || '#78716C'}
              />
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
              style={{ backgroundColor: SENTIMENT_COLORS[item.sentiment] || '#78716C' }}
            />
            <span className="text-xs capitalize text-text-secondary">
              {item.sentiment} ({item.percentage.toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
