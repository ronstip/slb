import { useState, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, Sector } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart.tsx';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import type { ChartOverrides } from './chart-overrides.ts';

interface PlatformBarProps {
  data: Array<{ platform: string; post_count: number }>;
  overrides?: ChartOverrides;
  onBarClick?: (platform: string) => void;
  activeFilters?: string[];
}

const chartConfig: ChartConfig = {
  post_count: { label: 'Posts' },
};

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px]">
        {PLATFORM_LABELS[payload.platform] || payload.platform}
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 3} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

export function PlatformBar({ data, overrides, onBarClick, activeFilters }: PlatformBarProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const total = data.reduce((sum, d) => sum + d.post_count, 0);

  const chartData = useMemo(() =>
    data.map((d) => ({
      ...d,
      percentage: total > 0 ? Math.round((d.post_count / total) * 1000) / 10 : 0,
    })),
  [data, total]);

  const getColor = (platform: string) =>
    overrides?.colorOverrides?.[platform] || PLATFORM_COLORS[platform] || '#78716C';

  const getOpacity = (platform: string) => {
    if (!activeFilters?.length) return 1;
    return activeFilters.includes(platform) ? 1 : 0.25;
  };

  const dominant = chartData.length > 0 ? chartData[0] : null;

  const handleClick = useCallback((_: unknown, index: number) => {
    if (onBarClick && chartData[index]) {
      onBarClick(chartData[index].platform);
    }
  }, [onBarClick, chartData]);

  return (
    <div className="flex items-center gap-4">
      <ChartContainer config={chartConfig} className="h-[140px] w-[140px] shrink-0">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="post_count"
            nameKey="platform"
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
            className={onBarClick ? 'cursor-pointer' : ''}
          >
            {chartData.map((entry) => (
              <Cell key={entry.platform} fill={getColor(entry.platform)} fillOpacity={getOpacity(entry.platform)} />
            ))}
          </Pie>
          {activeIndex === undefined && dominant && (
            <>
              <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-sm font-bold">
                {dominant.percentage.toFixed(0)}%
              </text>
              <text x="50%" y="59%" textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground text-[9px]">
                {PLATFORM_LABELS[dominant.platform] || dominant.platform}
              </text>
            </>
          )}
          <ChartTooltip
            content={<ChartTooltipContent nameKey="platform" hideLabel />}
          />
        </PieChart>
      </ChartContainer>
      <div className="flex min-w-0 flex-col gap-1.5">
        {chartData.map((item) => (
          <button
            key={item.platform}
            type="button"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
            style={{ opacity: getOpacity(item.platform) }}
            onClick={() => onBarClick?.(item.platform)}
          >
            <PlatformIcon platform={item.platform} className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              {PLATFORM_LABELS[item.platform] || item.platform}
              <span className="ml-1.5 font-semibold tabular-nums text-foreground">
                {item.percentage.toFixed(0)}%
              </span>
              <span className="ml-1 text-muted-foreground/50 tabular-nums">({item.post_count})</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
