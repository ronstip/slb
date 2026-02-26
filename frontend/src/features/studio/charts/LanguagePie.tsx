import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { LanguageDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface LanguagePieProps {
  data: LanguageDistribution[];
  overrides?: ChartOverrides;
}

const COLORS = ['#4F46E5', '#2DB87A', '#D4A030', '#C13584', '#7C3AED', '#1DA1F2', '#8B8B8B', '#A09020'];

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  it: 'Italian',
  ru: 'Russian',
  nl: 'Dutch',
  tr: 'Turkish',
  unknown: 'Unknown',
};

function getLanguageLabel(code: string): string {
  return LANGUAGE_LABELS[code.toLowerCase()] || code.toUpperCase();
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

export function LanguagePie({ data, overrides }: LanguagePieProps) {
  const top8 = data.slice(0, 8);

  const getColor = (language: string, index: number) =>
    overrides?.colorOverrides?.[language] || COLORS[index % COLORS.length];

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={top8}
            dataKey="percentage"
            nameKey="language"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {top8.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.language, i)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            labelFormatter={(label) => getLanguageLabel(String(label))}
            contentStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1">
        {top8.map((item, i) => (
          <div key={item.language} className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: getColor(item.language, i) }}
            />
            <span className="text-xs text-muted-foreground">
              {getLanguageLabel(item.language)} ({item.percentage.toFixed(0)}%)
              {overrides?.showValues && item.post_count != null && (
                <span className="ml-1 font-medium text-foreground/70">{item.post_count}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
