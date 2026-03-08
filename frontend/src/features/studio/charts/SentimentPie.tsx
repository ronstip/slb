import { useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Sector } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import type { SentimentBreakdown } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import type { ChartOverrides } from './chart-overrides.ts';

interface SentimentPieProps {
  data: SentimentBreakdown[];
  overrides?: ChartOverrides;
  onSegmentClick?: (sentiment: string) => void;
  activeFilters?: string[];
}

function resolveSentimentColor(sentiment: string): string {
  const lower = sentiment.toLowerCase();
  return SENTIMENT_COLORS[lower]
    ?? Object.entries(SENTIMENT_COLORS).find(([key]) => lower.startsWith(key))?.[1]
    ?? '#78716C';
}

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px] capitalize">
        {payload.sentiment}
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 3} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

export function SentimentPie({ data, overrides, onSegmentClick, activeFilters }: SentimentPieProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const getColor = (sentiment: string) =>
    overrides?.colorOverrides?.[sentiment] || resolveSentimentColor(sentiment);

  const getOpacity = (sentiment: string) => {
    if (!activeFilters?.length) return 1;
    return activeFilters.includes(sentiment) ? 1 : 0.25;
  };

  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((d) => [d.sentiment, { label: d.sentiment.charAt(0).toUpperCase() + d.sentiment.slice(1), color: getColor(d.sentiment) }]),
  );

  const dominant = data.length > 0 ? data[0] : null;

  const handleClick = useCallback((_: unknown, index: number) => {
    if (onSegmentClick && data[index]) {
      onSegmentClick(data[index].sentiment);
    }
  }, [onSegmentClick, data]);

  return (
    <div className="flex items-center gap-4">
      <ChartContainer config={chartConfig} className="h-[140px] w-[140px] shrink-0">
        <PieChart>
          <Pie
            data={data}
            dataKey="percentage"
            nameKey="sentiment"
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
            {data.map((entry) => (
              <Cell
                key={entry.sentiment}
                fill={getColor(entry.sentiment)}
                fillOpacity={getOpacity(entry.sentiment)}
              />
            ))}
          </Pie>
          {activeIndex === undefined && dominant && (
            <>
              <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
                {dominant.percentage.toFixed(0)}%
              </text>
              <text x="50%" y="59%" textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px] capitalize">
                {dominant.sentiment}
              </text>
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent nameKey="sentiment" hideLabel />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex min-w-0 flex-col gap-1.5">
        {data.map((item) => (
          <button
            key={item.sentiment}
            type="button"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
            style={{ opacity: getOpacity(item.sentiment) }}
            onClick={() => onSegmentClick?.(item.sentiment)}
          >
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: getColor(item.sentiment) }}
            />
            <span className="text-[11px] capitalize text-muted-foreground">
              {item.sentiment}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
              <span className="ml-1 text-muted-foreground/50 tabular-nums">
                ({item.count})
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
