import { useEffect, useRef, useState } from 'react';
import cloud from 'd3-cloud';
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
  // Wide min:max ratio (~5.5x) so the cloud has real size contrast like a
  // proper word cloud. The packed result is then auto-fit to the box (see
  // ThemeCloud), so this band only fixes the *relative* sizes, not absolute px.
  return { min: max * 0.18, max };
}

export interface CloudWordModel {
  /** Raw word text — drives color, click-to-filter and the tooltip key. */
  text: string;
  value: number;
  /** Font size in px, mapped from `value` across the adaptive range. */
  font: number;
  /** Layout rotation in degrees (0 or 90). */
  rotate: number;
  /** Font weight: heavy for the prominent words, medium otherwise. */
  weight: number;
  /** 0..1 share of the value range; powers font, weight and opacity. */
  normalized: number;
}

/** Stable, order-independent hash of a string — used to assign a word its
 *  rotation deterministically so the layout doesn't jitter between renders. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Turn the aggregated cloud words into pure layout models: size/weight from
 *  the value, and a deterministic rotation. Kept side-effect free and free of
 *  DOM/canvas access so it can be unit-tested without a browser. */
export function buildCloudWordModels(
  data: CloudWord[],
  fontRange: { min: number; max: number },
): CloudWordModel[] {
  const maxValue = data[0]?.value ?? 1;
  const minValue = data[data.length - 1]?.value ?? 1;
  const range = Math.max(maxValue - minValue, 1);
  return data.map((w) => {
    const normalized = (w.value - minValue) / range;
    const font = fontRange.min + normalized * (fontRange.max - fontRange.min);
    // Dominant words stay horizontal (readability); the rest get a stable, sparse
    // mix of upright and vertical (~14% vertical). Fewer vertical words keeps the
    // packed bounds wide/short — matching typical widget boxes so the auto-fit
    // fills the container instead of leaving top/bottom margin.
    const rotate = normalized > 0.8 ? 0 : hashString(w.text) % 7 === 0 ? 90 : 0;
    return { text: w.text, value: w.value, font, rotate, weight: normalized > 0.5 ? 700 : 500, normalized };
  });
}

/** The shape d3-cloud lays out. Mirrors its `Word` contract (`text`/`size`/
 *  `rotate`/`x`/`y`) and carries our extra fields (raw text, value, weight,
 *  normalized) so the render pass needs no second lookup. After layout, `x`/`y`
 *  are filled in as offsets from the box center. */
interface LayoutWord {
  /** Displayed text — what d3-cloud measures and what we render. */
  text: string;
  /** Font size in px (d3-cloud's `size`). */
  size: number;
  rotate: number;
  /** Raw word — drives color, click-to-filter and the tooltip key. */
  raw: string;
  value: number;
  weight: number;
  normalized: number;
  x?: number;
  y?: number;
}

export function ThemeCloud({ data, onWordClick, scale = 1, seriesColors, seriesLabels }: ThemeCloudProps) {
  const chartColors = useChartColors();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Placed words plus the auto-fit transform: `k` scales the whole packed
  // result to fill the box, `cx`/`cy` recenter the packed bounds on the box.
  const [layoutState, setLayoutState] = useState<{ words: LayoutWord[]; k: number; cx: number; cy: number }>({
    words: [],
    k: 1,
    cx: 0,
    cy: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Hysteresis guard: font size is derived from the measured width. Ignore
    // sub-scrollbar deltas (<= 20px) so a transient scrollbar can never set up
    // a grow/shrink oscillation (see docs/bugs/frontend-wordcloud-scrollbar-flicker.md).
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) =>
        prev.width === 0 || Math.abs(rect.width - prev.width) > 20 || Math.abs(rect.height - prev.height) > 20
          ? { width: rect.width, height: rect.height }
          : prev,
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Run the d3-cloud spiral layout whenever the data or box changes. The layout
  // is chunked/async, so it resolves on the 'end' event; we cancel in-flight
  // runs on cleanup to avoid a stale layout clobbering a newer one.
  // Relative font band only (min:max ratio). The *absolute* sizes are decided by
  // the fit loop below, so `scale` is applied there (as a fill target), not here.
  const { min: minFont, max: maxFont } = computeCloudFontRange(size.width, 1);
  // Fit-to-box layout. d3-cloud places words on a spiral but does NOT fill a
  // rectangle on its own. The old approach packed at container size then
  // upscaled the result (`k` up to 6×) — that magnifies d3-cloud's coarse
  // collision-grid near-misses into visible overlaps, and one stray word
  // inflates the bounds so the dense core shrinks (dead whitespace). Instead we
  // iterate: lay out, measure the packed bounds, multiply every font size by the
  // leftover room, and re-run. After 2–3 passes the cloud natively fills the box
  // at scale ≈1 — sizes adapt to the available space, no upscale overlap,
  // whitespace minimised. See docs/bugs/frontend-wordcloud-*.
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0 || data.length === 0) {
      setLayoutState({ words: [], k: 1, cx: 0, cy: 0 });
      return;
    }
    const base = buildCloudWordModels(data, { min: minFont, max: maxFont });
    // d3-cloud measures glyph boxes on a canvas; it must use the *same* font
    // family we render with (Inter is wider than generic sans-serif) or words
    // collide. Read it off the live container.
    const fontFamily = containerRef.current
      ? getComputedStyle(containerRef.current).fontFamily || 'sans-serif'
      : 'sans-serif';
    // User size multiplier from the Style tab becomes the fraction of the box
    // the cloud fills (can only shrink — you can't grow past the container).
    const targetFill = clamp(0.98 * scale, 0.2, 1);
    let cancelled = false;
    let active: ReturnType<typeof cloud<LayoutWord>> | null = null;

    type Bounds = { x: number; y: number }[] | undefined;
    const runOnce = (fontMul: number) =>
      new Promise<{ result: LayoutWord[]; bounds: Bounds }>((resolve) => {
        const words: LayoutWord[] = base.map((m) => ({
          text: seriesLabels?.[m.text] ?? m.text,
          size: m.font * fontMul,
          rotate: m.rotate,
          raw: m.text,
          value: m.value,
          weight: m.weight,
          normalized: m.normalized,
        }));
        active = cloud<LayoutWord>()
          .size([size.width, size.height])
          .words(words)
          .padding(1)
          .spiral('archimedean')
          .rotate((d) => d.rotate)
          .font(fontFamily)
          .fontWeight((d) => d.weight)
          .fontSize((d) => d.size)
          .text((d) => d.text)
          .on('end', (result, bounds) => resolve({ result, bounds: bounds as Bounds }));
        active.start();
      });

    const fit = async () => {
      // Wait for web fonts so canvas measurement matches the rendered metrics.
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }
      if (cancelled) return;
      let mul = 1;
      let final: { result: LayoutWord[]; bounds: Bounds } | null = null;
      for (let pass = 0; pass < 3; pass++) {
        const { result, bounds } = await runOnce(mul);
        if (cancelled) return;
        final = { result, bounds };
        if (!(result.length > 0 && bounds && bounds.length === 2)) break;
        const usedW = Math.max(bounds[1].x - bounds[0].x, 1);
        const usedH = Math.max(bounds[1].y - bounds[0].y, 1);
        const fill = Math.min(size.width / usedW, size.height / usedH) * targetFill;
        // Close enough, or out of passes → keep this layout.
        if (Math.abs(fill - 1) < 0.05 || pass === 2) break;
        mul = clamp(mul * fill, 0.1, 24);
      }
      if (cancelled || !final) return;
      const { result, bounds } = final;
      let cx = 0;
      let cy = 0;
      if (result.length > 0 && bounds && bounds.length === 2) {
        // d3-cloud reports `bounds` in absolute (0..size) space but sets each
        // word's x/y in center-relative space. Shift the bounds midpoint into the
        // same center-relative space, or the cloud flies off-screen.
        cx = (bounds[0].x + bounds[1].x) / 2 - size.width / 2;
        cy = (bounds[0].y + bounds[1].y) / 2 - size.height / 2;
      }
      // k stays 1: the fit loop sized the words, so there is no post-scale to
      // magnify near-overlaps.
      setLayoutState({ words: result, k: 1, cx, cy });
    };
    fit();

    return () => {
      cancelled = true;
      active?.stop();
    };
  }, [data, size.width, size.height, minFont, maxFont, seriesLabels, scale]);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-[11px] text-muted-foreground/60">
        No theme data available
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div ref={containerRef} className="relative h-full min-h-[200px] w-full overflow-hidden">
        {layoutState.words.map((word, i) => {
          const opacity = 0.5 + word.normalized * 0.5; // 0.5 to 1.0
          const color = seriesColors?.[word.raw] ?? chartColors[i % chartColors.length];
          const { k, cx, cy } = layoutState;
          return (
            <Tooltip key={word.raw}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute whitespace-nowrap rounded-md leading-none transition-[transform,opacity] [--s:1] hover:z-10 hover:[--s:1.18] hover:!opacity-100"
                  style={{
                    left: size.width / 2 + ((word.x ?? 0) - cx) * k,
                    top: size.height / 2 + ((word.y ?? 0) - cy) * k,
                    transform: `translate(-50%, -50%) rotate(${word.rotate}deg) scale(var(--s))`,
                    fontSize: `${word.size * k}px`,
                    color,
                    opacity,
                    fontWeight: word.weight,
                  }}
                  onClick={() => onWordClick?.(word.raw)}
                >
                  {word.text}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="font-semibold">{word.text}</div>
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
