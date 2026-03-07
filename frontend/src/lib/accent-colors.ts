// ── Accent Color Presets & Palette Generation ──

export interface AccentPreset {
  name: string;
  hex: string;
}

export const DEFAULT_ACCENT = '#06B6D4'; // Vibrant Cyan

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Fuchsia', hex: '#D946EF' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Orange', hex: '#EA580C' },
  { name: 'Amber', hex: '#D97706' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Teal', hex: '#0D9488' },
  { name: 'Sky', hex: '#0284C7' },
  { name: 'Pink', hex: '#DB2777' },
  { name: 'Lime', hex: '#65A30D' },
];

// ── Color conversion utilities ──

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; // normalize
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// ── Palette generation ──

/**
 * Generate 5 harmonious chart colors from a single accent using pentadic hue rotation.
 * Dark mode adjusts lightness for visibility on dark backgrounds.
 */
export function generateChartPalette(accentHex: string, isDark: boolean): string[] {
  const { h, s, l } = hexToHsl(accentHex);

  // For dark mode, ensure minimum lightness for visibility; for light mode, cap it
  const adjustL = (baseLightness: number) => {
    if (isDark) return Math.max(baseLightness, 0.55) + 0.1;
    return Math.min(baseLightness, 0.5);
  };

  // Keep saturation vivid
  const adjustS = (baseSat: number) => Math.max(baseSat, 0.5);

  const hueOffsets = [0, 72, 144, 216, 288]; // pentadic
  return hueOffsets.map((offset) =>
    hslToHex(h + offset, adjustS(s), adjustL(l)),
  );
}

/**
 * Returns a map of CSS custom properties to set for the given accent color.
 */
export function generateAccentVariants(
  accentHex: string,
  isDark: boolean,
): Record<string, string> {
  const palette = generateChartPalette(accentHex, isDark);

  return {
    '--color-accent-vibrant': accentHex,
    '--chart-1': palette[0],
    '--chart-2': palette[1],
    '--chart-3': palette[2],
    '--chart-4': palette[3],
    '--chart-5': palette[4],
  };
}
