import { useMemo, type ReactNode } from 'react';
import { Bell, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useTheme } from './theme-provider.tsx';

// Curated palette of warm, saturated bot colors — mirrors the design's
// agent characters (rust, indigo, forest, rose, amber, slate-blue, plum…).
const BOT_COLORS = [
  '#D97757', // rust orange (Claude primary)
  '#7B5BD9', // indigo
  '#2F8E6C', // forest
  '#3A6FB6', // slate blue
  '#C25E7E', // rose
  '#B6843A', // amber
  '#6B3F8C', // plum
  '#5A8C3E', // olive
  '#A04848', // brick
  '#3D6B6E', // teal
  '#D49306', // gold
  '#9E4A5A', // wine
  '#5A7FA0', // dusty blue
  '#3E6B52', // moss
  '#8B6040', // copper
];

// ── Bot chassis ──────────────────────────────────────────────────────
//
// Each chassis defines a complete bot silhouette: its body path, the
// position of its visor, where its eyes/mouth sit, and where the
// antennae anchor on top. Different chassis have visibly different
// proportions (boxy TV vs. tall canister vs. squat mini) so two bots
// from different chassis read as genuinely different characters — not
// just a recolour of the same shape.
//
// Coordinate system: 48×64 viewBox. The body lives in y ≈ 12..50.
// Below y=50 we leave room for the soft drop-shadow ellipse.
type Chassis = {
  /** SVG path for the body fill. */
  body: string;
  /** Path for the inner left-half shadow (uses an opaque dark mix). */
  shadow: string;
  /** Visor rectangle. */
  visor: { x: number; y: number; w: number; h: number; rx: number };
  /** Two-eye positions for binocular eye variants. */
  eyes: [{ cx: number; cy: number }, { cx: number; cy: number }];
  /** Single-eye centre for cyclop / visor-bar variants. */
  cyclop: { cx: number; cy: number };
  /** Mouth y-position (drawn as a small dark mark just below the visor). */
  mouthY: number;
  /** Where the body's top edge sits (so antennae meet it cleanly). */
  topY: number;
  /** x-positions where the two antennae attach. */
  antennaX: [number, number];
  /** Scale factor applied to the eye marks. Default 1. Used by chassis like
   *  the mushroom-stem where the design calls for big, prominent eyes that
   *  fill the visor instead of the default dot-sized eyes. */
  eyeScale?: number;
  /** Suppress antennae rendering — for chassis that read better with a
   *  clean top (the mushroom-stem cap, etc.). */
  noAntenna?: boolean;
  /** Suppress the mouth mark — for chassis whose face is just the visor. */
  noMouth?: boolean;
};

const CHASSIS: Chassis[] = [
  // 0 — TV box: squat, wide rectangular body with a big horizontal visor.
  // Body: y 18..50 (32 tall), x 6..42 (36 wide). The widest, shortest chassis.
  {
    body:   'M6 20 Q6 18 8 18 H40 Q42 18 42 20 V48 Q42 50 40 50 H8 Q6 50 6 48 Z',
    shadow: 'M6 20 Q6 18 8 18 H24 V50 H8 Q6 50 6 48 Z',
    visor:  { x: 10, y: 24, w: 28, h: 11, rx: 1.5 },
    eyes:   [{ cx: 16, cy: 29.5 }, { cx: 32, cy: 29.5 }],
    cyclop: { cx: 24, cy: 29.5 },
    mouthY: 43,
    topY: 18,
    antennaX: [14, 34],
  },
  // 1 — Upright: classic balanced rounded shoulders, medium proportions.
  // Body: y 14..50 (36 tall), x 11..37 (26 wide).
  {
    body:   'M11 26 Q11 14 24 14 Q37 14 37 26 V46 Q37 50 33 50 H15 Q11 50 11 46 Z',
    shadow: 'M11 26 Q11 14 24 14 V50 H15 Q11 50 11 46 Z',
    visor:  { x: 14, y: 22, w: 20, h: 8, rx: 2 },
    eyes:   [{ cx: 19, cy: 26 }, { cx: 29, cy: 26 }],
    cyclop: { cx: 24, cy: 26 },
    mouthY: 40,
    topY: 14,
    antennaX: [17, 31],
  },
  // 2 — Wide mushroom-dome: the demo's plump purple bot. Squat and wide
  // with a strongly rounded dome top and a near-full-width dark visor band
  // that takes up most of the upper face.
  // Body: y 10..50 (40 tall), x 6..42 (36 wide).
  {
    body:   'M6 30 Q6 10 24 10 Q42 10 42 30 V46 Q42 50 38 50 H10 Q6 50 6 46 Z',
    shadow: 'M6 30 Q6 10 24 10 V50 H10 Q6 50 6 46 Z',
    visor:  { x: 11, y: 22, w: 26, h: 12, rx: 4 },
    eyes:   [{ cx: 17, cy: 28 }, { cx: 31, cy: 28 }],
    cyclop: { cx: 24, cy: 28 },
    mouthY: 42,
    topY: 10,
    antennaX: [16, 32],
  },
  // 3 — Pebble: the rounded ceramic-figurine pebble from the All Agents
  // demo. Smooth dome top, gently rounded body, strong horizontal eye
  // band that takes up roughly half the face. Reads as a friendly,
  // squat character. Body: y 12..50 (38 tall), x 14..34 (20 wide).
  {
    body:   'M14 24 Q14 12 24 12 Q34 12 34 24 V44 Q34 50 28 50 H20 Q14 50 14 44 Z',
    shadow: 'M14 24 Q14 12 24 12 V50 H20 Q14 50 14 44 Z',
    visor:  { x: 17, y: 22, w: 14, h: 9, rx: 2 },
    eyes:   [{ cx: 20.5, cy: 26.5 }, { cx: 27.5, cy: 26.5 }],
    cyclop: { cx: 24, cy: 26.5 },
    mouthY: 40,
    topY: 12,
    antennaX: [22, 26],
  },
  // 4 — Egg: wider, slightly taller plump rounded body — the second
  // demo character. Two-eye band sits high. Reads as an "egg" or
  // chunkier sibling of the Pebble. Body: y 14..50 (36 tall), x 10..38 (28 wide).
  {
    body:   'M10 28 Q10 14 24 14 Q38 14 38 28 V46 Q38 50 34 50 H14 Q10 50 10 46 Z',
    shadow: 'M10 28 Q10 14 24 14 V50 H14 Q10 50 10 46 Z',
    visor:  { x: 14, y: 24, w: 20, h: 8, rx: 2 },
    eyes:   [{ cx: 20, cy: 28 }, { cx: 28, cy: 28 }],
    cyclop: { cx: 24, cy: 28 },
    mouthY: 41,
    topY: 14,
    antennaX: [18, 30],
  },
  // 5 — Mushroom-on-stem: the desk-lamp / mushroom-shaped character
  // straight from the All Agents template. A wide rounded cap sits on a
  // shorter, wider pedestal — two-part silhouette unlike any other
  // chassis. Cap: y 8..32 (24 tall), x 9..39 (30 wide). Stem: y 32..46
  // (14 tall), x 17..31 (14 wide). Big round eyes fill the visor band,
  // no antenna, no mouth — the face is just the visor.
  {
    body:   'M9 22 Q9 8 24 8 Q39 8 39 22 V28 Q39 32 35 32 H31 V44 Q31 46 29 46 H19 Q17 46 17 44 V32 H13 Q9 32 9 28 Z',
    shadow: 'M9 22 Q9 8 24 8 V46 H19 Q17 46 17 44 V32 H13 Q9 32 9 28 Z',
    visor:  { x: 12, y: 16, w: 24, h: 10, rx: 3 },
    eyes:   [{ cx: 18, cy: 21 }, { cx: 30, cy: 21 }],
    cyclop: { cx: 24, cy: 21 },
    mouthY: 28,
    topY: 8,
    antennaX: [20, 28],
    eyeScale: 2.2,
    noAntenna: true,
    noMouth: true,
  },
];

/**
 * Seed-based bot character avatar.
 *
 * Renders the Claude design's stylised "agent character". The bot is built
 * from a seeded chassis (6 distinct silhouettes — boxy TV, upright,
 * mushroom-dome, pebble, egg, mushroom-stem) plus seeded color, antennae,
 * eyes, and mouth marks. Bots from different chassis read as genuinely
 * different characters, not just colour swaps of the same shape.
 */
export function BotAvatar({
  seed,
  size = 48,
  className = '',
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const memo = useMemo(() => {
    let hash = 0;
    const s = seed ?? '';
    for (let i = 0; i < s.length; i++) {
      hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash);
    // Weighted picker — chassis index 5 (mushroom-on-stem) appears in
    // multiple slots so it shows up more often than the legacy shapes.
    // Without weighting, with 6 chassis the new shape only lands ~17% of
    // the time, which can be invisible across small agent libraries.
    const PICK_TABLE = [0, 1, 2, 3, 4, 5, 5, 5];
    return {
      color:          BOT_COLORS[h % BOT_COLORS.length],
      chassis:        CHASSIS[PICK_TABLE[(h >> 4) % PICK_TABLE.length]],
      antennaVariant: (h >> 8) % 4,                            // 4 antenna styles
      eyeVariant:     (h >> 12) % 4,                           // 4 eye styles
      mouthVariant:   (h >> 16) % 4,                           // 4 simple marks
    };
  }, [seed]);
  // Defensive defaults: HMR can occasionally preserve a stale useMemo
  // result whose shape predates the current module — guarantee every
  // field is defined before we read into it.
  const color           = memo.color           ?? BOT_COLORS[0];
  const chassis         = memo.chassis         ?? CHASSIS[0];
  const antennaVariant  = memo.antennaVariant  ?? 0;
  const eyeVariant      = memo.eyeVariant      ?? 0;
  const mouthVariant    = memo.mouthVariant    ?? 0;

  // 48×64 viewBox — the body sits in the upper portion and the soft drop
  // shadow lives in the bottom 14 px. Render at the requested width and
  // scale height proportionally.
  const w = size;
  const h = Math.round((size * 64) / 48);
  const shadowId = `bot-shadow-${color.replace('#', '')}`;

  // Light tinted version of the bot color for eyes — so they pop against
  // the dark visor band. Mirrors the demo's creamy/lit eye marks.
  const eyeColor = `color-mix(in oklab, ${color} 38%, #FFF7F0)`;

  // Antenna geometry derived from the active chassis.
  const [ax1, ax2] = chassis.antennaX;
  const aTop = chassis.topY;        // body's top edge
  const aShortStem = aTop - 4;      // short antenna start y
  const aTallStem  = aTop - 8;      // tall antenna start y

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 64"
      width={w}
      height={h}
      aria-hidden="true"
      className={className}
      animate={{ y: [0, -1.5, 0] }}
      transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <defs>
        <radialGradient id={shadowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(27,24,21,0.35)" />
          <stop offset="100%" stopColor="rgba(27,24,21,0)" />
        </radialGradient>
      </defs>

      {/* Soft drop shadow under the bot — sits below the body. */}
      <ellipse cx="24" cy="56" rx="14" ry="2.5" fill={`url(#${shadowId})`} />

      {/* Antennae — four variants, anchored to the chassis. Suppressed for
          chassis whose silhouette reads better with a clean top. */}
      {!chassis.noAntenna && antennaVariant === 0 && (
        // Short twins
        <>
          <path d={`M${ax1} ${aShortStem} V${aTop}`} stroke="#1B1815" strokeWidth="1.5" strokeLinecap="round" />
          <path d={`M${ax2} ${aShortStem} V${aTop}`} stroke="#1B1815" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx={ax1} cy={aShortStem - 1} r="1.8" fill={color} />
          <circle cx={ax2} cy={aShortStem - 1} r="1.8" fill={color} />
        </>
      )}
      {!chassis.noAntenna && antennaVariant === 1 && (
        // Tall twins
        <>
          <path d={`M${ax1} ${aTallStem} V${aTop}`} stroke="#1B1815" strokeWidth="1.5" strokeLinecap="round" />
          <path d={`M${ax2} ${aTallStem} V${aTop}`} stroke="#1B1815" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx={ax1} cy={aTallStem - 1} r="1.8" fill={color} />
          <circle cx={ax2} cy={aTallStem - 1} r="1.8" fill={color} />
        </>
      )}
      {!chassis.noAntenna && antennaVariant === 2 && (
        // Single tall centre antenna
        <>
          <path d={`M24 ${aTallStem - 2} V${aTop}`} stroke="#1B1815" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="24" cy={aTallStem - 3} r="2" fill={color} />
        </>
      )}
      {!chassis.noAntenna && antennaVariant === 3 && (
        // Bare — just two tiny knobs poking up off the body's top edge
        <>
          <rect x={ax1 - 1} y={aTop - 2} width="2" height="2.4" rx="0.6" fill="#1B1815" />
          <rect x={ax2 - 1} y={aTop - 2} width="2" height="2.4" rx="0.6" fill="#1B1815" />
        </>
      )}

      {/* Body silhouette + inner left-half shadow */}
      <path d={chassis.body} fill={color} />
      <path d={chassis.shadow} fill={`color-mix(in oklab, ${color} 80%, #1B1815)`} />

      {/* Visor — position from chassis */}
      <rect
        x={chassis.visor.x}
        y={chassis.visor.y}
        width={chassis.visor.w}
        height={chassis.visor.h}
        rx={chassis.visor.rx}
        fill="#1B1815"
      />

      {/* Eyes — four variants positioned by chassis. Filled with a light
          tinted version of the bot color so they pop against the dark visor.
          Chassis can opt into bigger eyes via `eyeScale`. */}
      {(() => {
        const es = chassis.eyeScale ?? 1;
        const dotR = 1.5 * es;
        const sqSize = 2.8 * es;
        const cyclopR = 1.9 * es;
        if (eyeVariant === 0) {
          return (
            <>
              <motion.circle cx={chassis.eyes[0].cx} cy={chassis.eyes[0].cy} r={dotR} fill={eyeColor}
                animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 3, repeat: Infinity, delay: 0.2 }} />
              <motion.circle cx={chassis.eyes[1].cx} cy={chassis.eyes[1].cy} r={dotR} fill={eyeColor}
                animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 3, repeat: Infinity, delay: 0.45 }} />
            </>
          );
        }
        if (eyeVariant === 1) {
          return (
            <>
              <rect x={chassis.eyes[0].cx - sqSize / 2} y={chassis.eyes[0].cy - sqSize / 2} width={sqSize} height={sqSize} rx={0.6 * es} fill={eyeColor} />
              <rect x={chassis.eyes[1].cx - sqSize / 2} y={chassis.eyes[1].cy - sqSize / 2} width={sqSize} height={sqSize} rx={0.6 * es} fill={eyeColor} />
            </>
          );
        }
        if (eyeVariant === 2) {
          // Visor-bar — a long pulsing horizontal line that spans the visor
          return (
            <motion.rect
              x={chassis.visor.x + 2} y={chassis.cyclop.cy - 0.7}
              width={chassis.visor.w - 4} height="1.4" rx="0.7" fill={eyeColor}
              animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 2.8, repeat: Infinity }}
            />
          );
        }
        // eyeVariant === 3 — single cyclop eye
        return (
          <circle cx={chassis.cyclop.cx} cy={chassis.cyclop.cy} r={cyclopR} fill={eyeColor} />
        );
      })()}

      {/* Mouth — four small dark marks (no smile, no cheeks). Suppressed
          for chassis whose face is just the visor. */}
      {!chassis.noMouth && mouthVariant === 0 && (
        // Tiny dot
        <circle cx="24" cy={chassis.mouthY} r="1.1" fill="#1B1815" />
      )}
      {!chassis.noMouth && mouthVariant === 1 && (
        // Short horizontal line
        <rect x="22" y={chassis.mouthY - 0.5} width="4" height="1.2" rx="0.6" fill="#1B1815" />
      )}
      {!chassis.noMouth && mouthVariant === 2 && (
        // Small square
        <rect x="22.5" y={chassis.mouthY - 1.25} width="3" height="2.5" rx="0.5" fill="#1B1815" />
      )}
      {!chassis.noMouth && mouthVariant === 3 && (
        // Vertical tick
        <rect x="23.4" y={chassis.mouthY - 1.5} width="1.2" height="3" rx="0.6" fill="#1B1815" />
      )}
    </motion.svg>
  );
}

/**
 * Shared utility eyebrow row used across the app's primary pages
 * (home, all-agents, etc.). Pattern: small primary dot + eyebrow text on the
 * left, a thin horizontal rule across the rest of the row, then the
 * notification + theme toggle on the right. The eyebrow content is supplied
 * as `children` so each page can show its own context (today's date, agent
 * counts, etc.).
 */
export function UtilityTopBar({
  children,
  hasNotification = false,
}: {
  children: ReactNode;
  hasNotification?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="flex items-center gap-4 pb-1">
      <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {children}
      </div>
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {hasNotification && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </button>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Pulsing green dot — signals an "active"/"running" state.
 * Size: 12px outer hit area, 8px inner dot.
 */
export function RadarPulse() {
  return (
    <div className="relative flex h-3 w-3 items-center justify-center">
      <motion.div
        className="absolute h-full w-full rounded-full bg-emerald-400"
        animate={{ scale: [1, 2], opacity: [0.6, 0] }}
        transition={{
          duration: 2.8,
          repeat: Infinity,
          scale: { ease: 'easeOut' },
          opacity: { ease: 'linear' },
        }}
      />
      <div className="relative h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
    </div>
  );
}

/**
 * Decorative static grid background for hero sections.
 * Position absolutely; parent needs `position: relative`.
 */
export function GeometricMesh() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.07]">
      <svg className="absolute h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="brand-mesh-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
              className="text-primary"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#brand-mesh-grid)" />
      </svg>
    </div>
  );
}

/**
 * Brand mark: purple rounded square with a swirling sonar sweep behind a white "V".
 * Sizes match the Logo component's sm/md/lg scale.
 */
export function AnimatedLogo({ size = 'md', flat = false }: { size?: 'sm' | 'md' | 'lg'; flat?: boolean }) {
  const dimensions = {
    sm: { box: 'h-7 w-7 rounded-md', sweep: 'h-14 w-14', text: 'text-sm' },
    md: { box: 'h-8 w-8 rounded-lg', sweep: 'h-16 w-16', text: 'text-lg' },
    lg: { box: 'h-10 w-10 rounded-lg', sweep: 'h-20 w-20', text: 'text-xl' },
  }[size];

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-primary ${flat ? '' : 'shadow-[0_2px_8px_rgba(255,107,61,0.25)]'} ${dimensions.box}`}
    >
      {!flat && (
        <motion.div
          className={`absolute bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.4)_45deg,transparent_90deg)] ${dimensions.sweep}`}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <span
        className={`relative z-10 font-heading font-bold leading-none text-white ${dimensions.text}`}
      >
        V
      </span>
    </div>
  );
}
