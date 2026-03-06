import { useMemo, useRef } from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme } from '../../../components/theme-provider.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { cn } from '../../../lib/utils.ts';
import { ACCENT_PRESETS, generateChartPalette } from '../../../lib/accent-colors.ts';

type ThemeOption = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: React.ElementType }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function AppearanceSection() {
  const { theme, setTheme, accentColor, setAccentColor } = useTheme();
  const customInputRef = useRef<HTMLInputElement>(null);

  const isCustom = !ACCENT_PRESETS.some((p) => p.hex === accentColor);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const palette = useMemo(
    () => generateChartPalette(accentColor, isDark),
    [accentColor, isDark],
  );

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <CardDescription>Select your preferred appearance.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                  theme === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Accent Color */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accent Color</CardTitle>
          <CardDescription>Choose your brand color for the interface and charts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Preset grid */}
          <div className="flex flex-wrap gap-3">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                onClick={() => setAccentColor(preset.hex)}
                title={preset.name}
                className={cn(
                  'relative h-8 w-8 rounded-full transition-transform hover:scale-110',
                  accentColor === preset.hex && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                )}
                style={{ backgroundColor: preset.hex }}
              >
                {accentColor === preset.hex && (
                  <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-sm" />
                )}
              </button>
            ))}

            {/* Custom color */}
            <button
              onClick={() => customInputRef.current?.click()}
              title="Custom color"
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border transition-transform hover:scale-110',
                isCustom && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
              style={isCustom ? { backgroundColor: accentColor } : undefined}
            >
              {isCustom ? (
                <Check className="h-4 w-4 text-white drop-shadow-sm" />
              ) : (
                <span className="text-xs font-bold text-muted-foreground">+</span>
              )}
              <input
                ref={customInputRef}
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="sr-only"
                tabIndex={-1}
              />
            </button>
          </div>

          {/* Palette preview */}
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Chart palette preview</p>
            <div className="flex gap-1.5">
              {palette.map((color, i) => (
                <div
                  key={i}
                  className="h-6 flex-1 rounded-md first:rounded-l-lg last:rounded-r-lg"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
