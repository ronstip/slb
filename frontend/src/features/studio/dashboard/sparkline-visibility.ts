import type { NumberSize } from './types-social-dashboard.ts';

/** Per-size default for whether a KPI card shows its trendline sparkline.
 *  Small cards have no vertical room, so they default off. */
const SIZE_SPARKLINE_DEFAULT: Record<NumberSize, boolean> = {
  small: false,
  medium: true,
  big: true,
};

/** Resolve whether a KPI card's trendline should render.
 *
 *  `showSparkline` is the explicit per-widget toggle (Style tab). When
 *  undefined the size default applies, preserving legacy behaviour for
 *  widgets saved before the toggle existed. An explicit value always wins,
 *  so users can turn the trendline off on a medium/big card or on for a
 *  small one. */
export function resolveSparklineEnabled(
  size: NumberSize,
  showSparkline: boolean | undefined,
): boolean {
  return showSparkline ?? SIZE_SPARKLINE_DEFAULT[size];
}

/** Convert a per-bucket series into a running total, so the trendline shows
 *  accumulation over time instead of per-bucket values. Returns a new array. */
export function toCumulativeSeries(values: number[]): number[] {
  let running = 0;
  return values.map((v) => (running += v));
}
