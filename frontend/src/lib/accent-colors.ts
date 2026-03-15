// ── Accent Color Presets & Palette Generation ──

export interface AccentPreset {
  name: string;
  hex: string;
}

export const DEFAULT_ACCENT = '#4A7C8F'; // Steel Teal

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Steel Teal', hex: '#4A7C8F' },
  { name: 'Navy', hex: '#2B5066' },
  { name: 'Slate Blue', hex: '#5A7FA0' },
  { name: 'Burgundy', hex: '#6B3040' },
  { name: 'Rose', hex: '#9E4A5A' },
  { name: 'Amber', hex: '#9A7B3C' },
  { name: 'Forest', hex: '#3E6B52' },
  { name: 'Charcoal', hex: '#4A5568' },
  { name: 'Copper', hex: '#8B6040' },
  { name: 'Plum', hex: '#6B4A6E' },
  { name: 'Olive', hex: '#5C6B3A' },
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
 * Generate 5 monochromatic chart colors from a single accent.
 * Varies lightness and slight saturation to create professional tonal shades.
 * Dark mode adjusts for visibility on dark backgrounds.
 */
export function generateChartPalette(accentHex: string, isDark: boolean): string[] {
  const { h, s } = hexToHsl(accentHex);

  // Monochromatic: same hue, varying lightness/saturation
  const shades = isDark
    ? [
        { l: 0.55, sFactor: 1.0 },   // base (medium)
        { l: 0.70, sFactor: 0.75 },   // lighter, muted
        { l: 0.40, sFactor: 1.1 },    // darker, slightly richer
        { l: 0.62, sFactor: 0.60 },   // soft mid-tone
        { l: 0.48, sFactor: 0.85 },   // deep muted
      ]
    : [
        { l: 0.35, sFactor: 0.90 },   // deep (primary)
        { l: 0.50, sFactor: 0.75 },   // medium
        { l: 0.25, sFactor: 1.0 },    // darkest
        { l: 0.62, sFactor: 0.55 },   // soft/light
        { l: 0.42, sFactor: 0.65 },   // mid muted
      ];

  return shades.map(({ l, sFactor }) =>
    hslToHex(h, Math.min(s * sFactor, 0.85), l),
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
    '--primary': accentHex,
    '--primary-foreground': '#FFFFFF',
    '--ring': accentHex,
    '--chart-1': palette[0],
    '--chart-2': palette[1],
    '--chart-3': palette[2],
    '--chart-4': palette[3],
    '--chart-5': palette[4],
  };
}
