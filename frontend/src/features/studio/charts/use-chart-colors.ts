import { useMemo } from 'react';
import { useTheme } from '../../../components/theme-provider.tsx';
import { generateChartPalette } from '../../../lib/accent-colors.ts';

/**
 * Returns 5 resolved hex colors derived from the user's accent color.
 * Use this in charts that need inline hex values (e.g., Recharts Cell fill).
 */
export function useChartColors(): string[] {
  const { accentColor, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return useMemo(() => generateChartPalette(accentColor, isDark), [accentColor, isDark]);
}
