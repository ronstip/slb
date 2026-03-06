import { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_ACCENT, generateAccentVariants } from '../lib/accent-colors.ts';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  accentColor: string;
  setAccentColor: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  accentColor: DEFAULT_ACCENT,
  setAccentColor: () => {},
});

const STORAGE_KEY = 'sl-theme';
const ACCENT_STORAGE_KEY = 'sl-accent-color';

function resolveIsDark(t: Theme): boolean {
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
    } catch {
      return 'system';
    }
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    try {
      return localStorage.getItem(ACCENT_STORAGE_KEY) || DEFAULT_ACCENT;
    } catch {
      return DEFAULT_ACCENT;
    }
  });

  // Apply dark/light class + accent CSS variables
  useEffect(() => {
    const root = document.documentElement;

    const apply = (t: Theme, accent: string) => {
      const isDark = resolveIsDark(t);
      root.classList.toggle('dark', isDark);

      // Set accent-derived CSS custom properties
      const vars = generateAccentVariants(accent, isDark);
      for (const [prop, value] of Object.entries(vars)) {
        root.style.setProperty(prop, value);
      }
    };

    apply(theme, accentColor);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system', accentColor);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme, accentColor]);

  const handleSetTheme = (t: Theme) => {
    setTheme(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  };

  const handleSetAccent = (hex: string) => {
    setAccentColor(hex);
    try { localStorage.setItem(ACCENT_STORAGE_KEY, hex); } catch {}
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, accentColor, setAccentColor: handleSetAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
