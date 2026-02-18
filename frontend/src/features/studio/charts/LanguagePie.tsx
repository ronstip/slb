import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { LanguageDistribution } from '../../../api/types.ts';

interface LanguagePieProps {
  data: LanguageDistribution[];
}

const COLORS = ['#6B8CAE', '#7BA589', '#B89A6A', '#A8788C', '#8B7EB8', '#7AABB8', '#9E9E9E', '#87876E'];

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

export function LanguagePie({ data }: LanguagePieProps) {
  const top8 = data.slice(0, 8);

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
          >
            {top8.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
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
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-xs text-muted-foreground">
              {getLanguageLabel(item.language)} ({item.percentage.toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
