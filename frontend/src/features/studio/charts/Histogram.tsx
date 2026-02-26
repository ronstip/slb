import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { formatNumber } from '../../../lib/format.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface HistogramBucket {
  bucket: string;
  count: number;
}

interface HistogramProps {
  data: HistogramBucket[];
  overrides?: ChartOverrides;
}

const DEFAULT_BAR_COLOR = '#4F46E5';

export function Histogram({ data, overrides }: HistogramProps) {
  const barColor = overrides?.colorOverrides?.['bar'] || DEFAULT_BAR_COLOR;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} width={38} tickFormatter={formatNumber} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="count" fill={barColor} radius={[2, 2, 0, 0]}>
          {overrides?.showValues && (
            <LabelList dataKey="count" position="top" style={{ fontSize: 9 }} />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
