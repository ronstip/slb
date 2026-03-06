import { PieChart, Pie, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { LanguageDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface LanguagePieProps {
  data: LanguageDistribution[];
  overrides?: ChartOverrides;
}

const chartConfig: ChartConfig = {
  percentage: { label: 'Share' },
};

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
  const chartColors = useChartColors();
  const top8 = data.slice(0, 8);

  const getColor = (language: string, index: number) =>
    overrides?.colorOverrides?.[language] || chartColors[index % chartColors.length];

  return (
    <div className="flex items-center gap-6">
      <ChartContainer config={chartConfig} className="h-[200px] w-[200px]">
        <PieChart>
          <Pie
            data={top8}
            dataKey="percentage"
            nameKey="language"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={88}
            strokeWidth={2}
            stroke="var(--background)"
            label={overrides?.showValues ? renderPieLabel : false}
            labelLine={false}
          >
            {top8.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.language, i)} />
            ))}
          </Pie>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => `${Number(value).toFixed(1)}%`}
                labelFormatter={(label) => getLanguageLabel(String(label))}
              />
            }
          />
        </PieChart>
      </ChartContainer>
      <div className="flex flex-col gap-2">
        {top8.map((item, i) => (
          <div key={item.language} className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.language, i) }}
            />
            <span className="text-[11px] text-muted-foreground">
              {getLanguageLabel(item.language)}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
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
