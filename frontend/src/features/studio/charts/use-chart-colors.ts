import { useMemo } from 'react';
import { useTheme } from '../../../components/theme-provider.tsx';
import { getCategoricalPalette } from '../../../lib/accent-colors.ts';

/**
 * Returns the design's categorical chart palette (multi-hue), resolved for the
 * active theme. Use this in charts that need inline hex values (e.g., Recharts
 * Cell fill, word clouds) so categories read as distinct colors rather than
 * monochromatic shades of the single accent.
 */
export function useChartColors(): string[] {
  const { theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return useMemo(() => getCategoricalPalette(isDark, 7), [isDark]);
}
