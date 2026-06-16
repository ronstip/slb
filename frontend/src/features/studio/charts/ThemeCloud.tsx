import { useEffect, useRef, useState } from 'react';
import { useChartColors } from './use-chart-colors.ts';
import type { CloudWord } from '../dashboard/dashboard-aggregations.ts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ThemeCloudProps {
  data: CloudWord[];
  onWordClick?: (word: string) => void;
  /** User size multiplier from the Style tab (1 = default). Scales the whole
   *  adaptive range up/down. */
  scale?: number;
  /** Per-word color overrides, keyed by the raw word text. Mirrors the other
   *  charts' `styleOverrides.seriesColors` so the Style tab and co-author AI
   *  can recolor individual words. Falls back to the categorical palette. */
  seriesColors?: Record<string, string>;
  /** Per-word display-name overrides, keyed by the raw word text. The raw text
   *  still drives color lookup, click-to-filter, and the tooltip key. */
  seriesLabels?: Record<string, string>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Adaptive font range for the word cloud: the largest word scales with the
 *  container width (so a small widget doesn't render at the old hardcoded 40px)
 *  and is clamped to a readable band. `scale` is the user multiplier. The
 *  smallest word is a fixed fraction of the largest. */
export function computeCloudFontRange(width: number, scale = 1): { min: number; max: number } {
  const w = width > 0 ? width : 360;
  const max = clamp(w * 0.055, 16, 40) * scale;
  return { min: max * 0.45, max };
}

export function ThemeCloud({ data, onWordClick, scale = 1, seriesColors, seriesLabels }: ThemeCloudProps) {
  const chartColors = useChartColors();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const { min: minFont, max: maxFont } = computeCloudFontRange(width, scale);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        ref={containerRef}
        className="flex min-h-[200px] flex-wrap items-center justify-center gap-x-3 gap-y-2 px-2 py-4"
      >
        {data.map((word, i) => {
          const normalized = (word.value - minValue) / range;
          const fontSize = minFont + normalized * (maxFont - minFont);
          const opacity = 0.5 + normalized * 0.5; // 0.5 to 1.0
          const color = seriesColors?.[word.text] ?? chartColors[i % chartColors.length];
          const display = seriesLabels?.[word.text] ?? word.text;

          return (
            <Tooltip key={word.text}>
              <TooltipTrigger asChild>
                <button
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
                >
                  {display}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="font-semibold">{display}</div>
                <div className="opacity-80">
                  Posts: <span className="font-medium">{word.value.toLocaleString()}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
