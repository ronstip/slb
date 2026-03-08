import { useChartColors } from './use-chart-colors.ts';
import type { CloudWord } from '../dashboard/dashboard-aggregations.ts';

interface ThemeCloudProps {
  data: CloudWord[];
  onWordClick?: (word: string) => void;
}

export function ThemeCloud({ data, onWordClick }: ThemeCloudProps) {
  const chartColors = useChartColors();

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[11px] text-muted-foreground/60">
        No theme data available
      </div>
    );
  }

  const maxValue = data[0]?.value ?? 1;
  const minValue = data[data.length - 1]?.value ?? 1;
  const range = Math.max(maxValue - minValue, 1);

  return (
    <div className="flex min-h-[200px] flex-wrap items-center justify-center gap-x-3 gap-y-2 px-2 py-4">
      {data.map((word, i) => {
        const normalized = (word.value - minValue) / range;
        const fontSize = 12 + normalized * 28; // 12px to 40px
        const opacity = 0.5 + normalized * 0.5; // 0.5 to 1.0
        const color = chartColors[i % chartColors.length];

        return (
          <button
            key={word.text}
            type="button"
            className="inline-block rounded-md px-1.5 py-0.5 transition-all hover:scale-110 hover:bg-muted/50"
            style={{
              fontSize: `${fontSize}px`,
              color,
              opacity,
              fontWeight: normalized > 0.5 ? 700 : 500,
              lineHeight: 1.2,
            }}
            onClick={() => onWordClick?.(word.text)}
            title={`${word.text}: ${word.value} posts`}
          >
            {word.text}
          </button>
        );
      })}
    </div>
  );
}
