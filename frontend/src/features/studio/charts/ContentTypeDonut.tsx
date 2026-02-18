import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { ContentTypeBreakdown } from '../../../api/types.ts';

interface ContentTypeDonutProps {
  data: ContentTypeBreakdown[];
}

const COLORS = ['#6B7B9E', '#7BA589', '#B89A6A', '#A87878', '#8E8E93', '#A8788C', '#6A9AB8'];

export function ContentTypeDonut({ data }: ContentTypeDonutProps) {
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="content_type"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            contentStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1">
        {data.slice(0, 6).map((item, i) => (
          <div key={item.content_type} className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-xs capitalize text-muted-foreground">
              {item.content_type} ({item.percentage.toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
