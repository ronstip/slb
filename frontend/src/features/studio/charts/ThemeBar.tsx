import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ThemeDistribution } from '../../../api/types.ts';

interface ThemeBarProps {
  data: ThemeDistribution[];
}

const BAR_COLOR = '#3B82F6'; // blue-500

export function ThemeBar({ data }: ThemeBarProps) {
  const top10 = data.slice(0, 10);

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, top10.length * 28)}>
      <BarChart data={top10} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="theme" tick={{ fontSize: 10 }} width={75} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="post_count" fill={BAR_COLOR} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
