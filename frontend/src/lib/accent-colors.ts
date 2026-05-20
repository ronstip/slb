// ── Accent Color Presets & Palette Generation ──

export interface AccentPreset {
  name: string;
  hex: string;
}

export const DEFAULT_ACCENT = '#D97757'; // Claude rust orange

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Claude Rust', hex: '#D97757' },
  { name: 'Purple', hex: '#A855F7' },
  { name: 'Navy', hex: '#3B5998' },
  { name: 'Slate Blue', hex: '#5A7FA0' },
  { name: 'Burgundy', hex: '#6B3040' },
  { name: 'Rose', hex: '#9E4A5A' },
  { name: 'Amber', hex: '#9A7B3C' },
  { name: 'Forest', hex: '#3E6B52' },
  { name: 'Charcoal', hex: '#4A5568' },
  { name: 'Copper', hex: '#8B6040' },
  { name: 'Plum', hex: '#6B4A6E' },
  { name: 'Storm', hex: '#4A6072' },
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
 * Editorial categorical chart palette — warm, brand-tuned, distinct in hue
 * so adjacent series in stacked bars and donut slices stay readable. Used as
 * the default for `--chart-1` … `--chart-5` and as the seed palette for
 * widget chart series. When the user picks a non-default accent we lead the
 * palette with their accent and fill the rest with editorial categoricals so
 * the brand colour still anchors the first series. Dark mode lifts each hue
 * slightly so they don't muddy on the ink background.
 */
const EDITORIAL_PALETTE_LIGHT = [
  '#D97757', // terracotta (primary)
  '#2F8E6C', // green
  '#3A6FB6', // blue
  '#7B5BD9', // purple
  '#B6843A', // amber
] as const;

const EDITORIAL_PALETTE_DARK = [
  '#E68B6E', // terracotta lifted
  '#56B58D', // green lifted
  '#6A95D8', // blue lifted
  '#A488F0', // purple lifted
  '#D8A45A', // amber lifted
] as const;

export function generateChartPalette(accentHex: string, isDark: boolean): string[] {
  const editorial = isDark ? [...EDITORIAL_PALETTE_DARK] : [...EDITORIAL_PALETTE_LIGHT];
  // If the user customised the accent away from the default terracotta, lead
  // with their accent so the first series keeps brand alignment, then fill
  // with the remaining editorial hues for hue separation.
  const normalised = accentHex.toLowerCase();
  if (normalised !== DEFAULT_ACCENT.toLowerCase()) {
    return [accentHex, ...editorial.slice(1)];
  }
  return editorial;
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
    '--primary': accentHex,
    '--primary-foreground': '#FFF7F0',
    '--sidebar-primary': accentHex,
    '--sidebar-primary-foreground': '#FFF7F0',
    '--sidebar-ring': accentHex,
    '--ring': accentHex,
    '--chart-1': palette[0],
    '--chart-2': palette[1],
    '--chart-3': palette[2],
    '--chart-4': palette[3],
    '--chart-5': palette[4],
  };
}
