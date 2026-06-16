import type { CloudWord } from './dashboard-aggregations.ts';
import { ThemeCloud } from '../charts/ThemeCloud.tsx';

interface SocialWordCloudWidgetProps {
  data: CloudWord[];
  onWordClick?: (word: string) => void;
  /** Size multiplier from the widget's style overrides (1 = default). */
  scale?: number;
  /** Per-word color overrides (styleOverrides.seriesColors). */
  seriesColors?: Record<string, string>;
  /** Per-word rename overrides (styleOverrides.seriesLabels). */
  seriesLabels?: Record<string, string>;
}

export function SocialWordCloudWidget({ data, onWordClick, scale, seriesColors, seriesLabels }: SocialWordCloudWidgetProps) {
  return (
    <div className="h-full overflow-y-auto">
      <ThemeCloud
        data={data}
        onWordClick={onWordClick}
        scale={scale}
        seriesColors={seriesColors}
        seriesLabels={seriesLabels}
      />
    </div>
  );
}
