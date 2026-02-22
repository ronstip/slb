import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import type { ThemeDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface ThemeBarProps {
  data: ThemeDistribution[];
  overrides?: ChartOverrides;
}

const DEFAULT_BAR_COLOR = '#6B8CAE';

export function ThemeBar({ data, overrides }: ThemeBarProps) {
  const top10 = data.slice(0, 10);
  const barColor = overrides?.colorOverrides?.['bar'] || DEFAULT_BAR_COLOR;

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, top10.length * 28)}>
      <BarChart data={top10} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="theme" tick={{ fontSize: 10 }} width={75} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="post_count" fill={barColor} radius={[0, 2, 2, 0]}>
          {overrides?.showValues && (
            <LabelList dataKey="post_count" position="right" style={{ fontSize: 10 }} />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
