// Loads the exact marketing typefaces (Google Fonts) and exposes the resolved
// family names. Mirrors WC_FONT in parts.jsx:
//   display Bricolage Grotesque · serif Fraunces · sans Inter Tight · mono JetBrains Mono
import { loadFont as loadDisplay } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadSerif } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadSans } from '@remotion/google-fonts/InterTight';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: display } = loadDisplay();
const { fontFamily: serif } = loadSerif();
const { fontFamily: sans } = loadSans();
const { fontFamily: mono } = loadMono();

export const F = {
  display: `${display}, ui-sans-serif, system-ui, sans-serif`,
  serif: `${serif}, Georgia, serif`,
  sans: `${sans}, 'Inter', system-ui, sans-serif`,
  mono: `${mono}, ui-monospace, monospace`,
} as const;
