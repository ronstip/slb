import { useState, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Sector } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { LanguageDistribution } from '../../../api/types.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface LanguagePieProps {
  data: LanguageDistribution[];
  overrides?: ChartOverrides;
  onSegmentClick?: (language: string) => void;
  activeFilters?: string[];
}

const chartConfig: ChartConfig = {
  percentage: { label: 'Share' },
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  ar: 'Arabic', hi: 'Hindi', it: 'Italian', ru: 'Russian',
  nl: 'Dutch', tr: 'Turkish', unknown: 'Unknown',
};

function getLanguageLabel(code: string): string {
  return LANGUAGE_LABELS[code.toLowerCase()] || code.toUpperCase();
}

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px]">
        {getLanguageLabel(payload.language)}
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 3} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

export function LanguagePie({ data, overrides, onSegmentClick, activeFilters }: LanguagePieProps) {
  const chartColors = useChartColors();
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  // Top 6 + "Other" bucket
  const chartData = useMemo(() => {
    const top6 = data.slice(0, 6);
    const rest = data.slice(6);
    if (rest.length === 0) return top6;
    const otherPct = rest.reduce((s, d) => s + d.percentage, 0);
    const otherCount = rest.reduce((s, d) => s + d.post_count, 0);
    return [...top6, { language: 'other', post_count: otherCount, percentage: Math.round(otherPct * 10) / 10 }];
  }, [data]);

  const getColor = (language: string, index: number) =>
    overrides?.colorOverrides?.[language] || chartColors[index % chartColors.length];

  const getOpacity = (language: string) => {
    if (!activeFilters?.length) return 1;
    return activeFilters.includes(language) ? 1 : 0.25;
  };

  const dominant = chartData.length > 0 ? chartData[0] : null;

  const handleClick = useCallback((_: unknown, index: number) => {
    if (onSegmentClick && chartData[index] && chartData[index].language !== 'other') {
      onSegmentClick(chartData[index].language);
    }
  }, [onSegmentClick, chartData]);

  return (
    <div className="flex items-center gap-4">
      <ChartContainer config={chartConfig} className="h-[140px] w-[140px] shrink-0">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="percentage"
            nameKey="language"
            cx="50%"
            cy="50%"
            innerRadius={38}
            outerRadius={62}
            strokeWidth={2}
            stroke="var(--background)"
            labelLine={false}
            activeIndex={activeIndex}
            activeShape={renderActiveShape}
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(undefined)}
            onClick={handleClick}
            className={onSegmentClick ? 'cursor-pointer' : ''}
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.language, i)} fillOpacity={getOpacity(entry.language)} />
            ))}
          </Pie>
          {activeIndex === undefined && dominant && (
            <>
              <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
                {dominant.percentage.toFixed(0)}%
              </text>
              <text x="50%" y="59%" textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px]">
                {getLanguageLabel(dominant.language)}
              </text>
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent nameKey="language" hideLabel />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex min-w-0 flex-col gap-1.5">
        {chartData.map((item, i) => (
          <button
            key={item.language}
            type="button"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
            style={{ opacity: getOpacity(item.language) }}
            onClick={() => item.language !== 'other' && onSegmentClick?.(item.language)}
          >
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.language, i) }}
            />
            <span className="text-[11px] text-muted-foreground">
              {getLanguageLabel(item.language)}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
