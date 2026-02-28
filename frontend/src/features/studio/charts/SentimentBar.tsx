import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface SentimentBarProps {
  data: SentimentBreakdown[];
  overrides?: ChartOverrides;
}

function resolveSentimentColor(sentiment: string): string {
  const lower = sentiment.toLowerCase();
  // Exact match first, then prefix match (handles "positive (by views)" etc.)
  return SENTIMENT_COLORS[lower]
    ?? Object.entries(SENTIMENT_COLORS).find(([key]) => lower.startsWith(key))?.[1]
    ?? '#78716C';
}

export function SentimentBar({ data, overrides }: SentimentBarProps) {
  const getColor = (sentiment: string) =>
    overrides?.colorOverrides?.[sentiment] || resolveSentimentColor(sentiment);

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
            <Cell key={entry.sentiment} fill={getColor(entry.sentiment)} />
          ))}
          {overrides?.showValues && (
            <LabelList dataKey="percentage" position="right" formatter={(v: number) => `${v.toFixed(0)}%`} style={{ fontSize: 10 }} />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
