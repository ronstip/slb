import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { ContentTypeBreakdown } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface ContentTypeDonutProps {
  data: ContentTypeBreakdown[];
  overrides?: ChartOverrides;
}

const COLORS = ['#6B7B9E', '#7BA589', '#B89A6A', '#A87878', '#8E8E93', '#A8788C', '#6A9AB8'];

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
  const getColor = (contentType: string, index: number) =>
    overrides?.colorOverrides?.[contentType] || COLORS[index % COLORS.length];

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
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.content_type, i)} />
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
              style={{ backgroundColor: getColor(item.content_type, i) }}
            />
            <span className="text-xs capitalize text-muted-foreground">
              {item.content_type} ({item.percentage.toFixed(0)}%)
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
