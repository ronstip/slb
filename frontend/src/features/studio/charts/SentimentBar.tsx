import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';

interface SentimentBarProps {
  data: SentimentBreakdown[];
}

export function SentimentBar({ data }: SentimentBarProps) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} layout="vertical" margin={{ left: 60, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
        <YAxis
          type="category"
          dataKey="sentiment"
          tick={{ fontSize: 11, textTransform: 'capitalize' } as object}
          width={55}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Percentage']}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.sentiment}
              fill={SENTIMENT_COLORS[entry.sentiment] || '#78716C'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
