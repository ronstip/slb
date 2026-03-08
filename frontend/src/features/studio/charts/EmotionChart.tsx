import { useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Sector } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { useChartColors } from './use-chart-colors.ts';
import type { EmotionBreakdown } from '../dashboard/dashboard-aggregations.ts';

const EMOTION_COLORS: Record<string, string> = {
  joy: '#22C55E',
  happiness: '#22C55E',
  love: '#EC4899',
  excitement: '#F97316',
  surprise: '#A855F7',
  sadness: '#3B82F6',
  anger: '#EF4444',
  fear: '#6366F1',
  disgust: '#84CC16',
  trust: '#06B6D4',
  anticipation: '#F59E0B',
  contempt: '#78716C',
  neutral: '#94A3B8',
  frustration: '#F87171',
};

interface EmotionChartProps {
  data: EmotionBreakdown[];
  onSegmentClick?: (emotion: string) => void;
  activeFilters?: string[];
}

const chartConfig: ChartConfig = {
  count: { label: 'Posts' },
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px] capitalize">
        {payload.emotion}
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 3} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

export function EmotionChart({ data, onSegmentClick, activeFilters }: EmotionChartProps) {
  const chartColors = useChartColors();
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  if (data.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-[11px] text-muted-foreground/60">
        No emotion data available
      </div>
    );
  }

  const chartData = data.slice(0, 8);

  const getColor = (emotion: string, index: number) =>
    EMOTION_COLORS[emotion.toLowerCase()] || chartColors[index % chartColors.length];

  const getOpacity = (emotion: string) => {
    if (!activeFilters?.length) return 1;
    return activeFilters.includes(emotion) ? 1 : 0.25;
  };

  const dominant = chartData[0];

  const handleClick = useCallback((_: unknown, index: number) => {
    if (onSegmentClick && chartData[index]) {
      onSegmentClick(chartData[index].emotion);
    }
  }, [onSegmentClick, chartData]);

  return (
    <div className="flex items-center gap-4">
      <ChartContainer config={chartConfig} className="h-[140px] w-[140px] shrink-0">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="count"
            nameKey="emotion"
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
              <Cell key={entry.emotion} fill={getColor(entry.emotion, i)} fillOpacity={getOpacity(entry.emotion)} />
            ))}
          </Pie>
          {activeIndex === undefined && dominant && (
            <>
              <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
                {dominant.percentage.toFixed(0)}%
              </text>
              <text x="50%" y="59%" textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px] capitalize">
                {dominant.emotion}
              </text>
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent nameKey="emotion" hideLabel />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex min-w-0 flex-col gap-1.5">
        {chartData.map((item, i) => (
          <button
            key={item.emotion}
            type="button"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
            style={{ opacity: getOpacity(item.emotion) }}
            onClick={() => onSegmentClick?.(item.emotion)}
          >
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.emotion, i) }}
            />
            <span className="text-[11px] text-muted-foreground">
              {capitalize(item.emotion)}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
              <span className="ml-1 text-muted-foreground/50 tabular-nums">({item.count})</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
