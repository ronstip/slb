import type { ReactNode } from 'react';

// ─── Palette ────────────────────────────────────────────────────────
interface Palette {
  from: string;
  to: string;
  stroke: string;
}

const PALETTES: Palette[] = [
  { from: '#3B82F6', to: '#1D4ED8', stroke: '#1E40AF' },   // blue
  { from: '#8B5CF6', to: '#6D28D9', stroke: '#5B21B6' },   // violet
  { from: '#10B981', to: '#059669', stroke: '#047857' },   // emerald
  { from: '#F59E0B', to: '#D97706', stroke: '#B45309' },   // amber
  { from: '#F43F5E', to: '#E11D48', stroke: '#BE123C' },   // rose
  { from: '#06B6D4', to: '#0891B2', stroke: '#0E7490' },   // cyan
  { from: '#EC4899', to: '#DB2777', stroke: '#BE185D' },   // fuchsia
  { from: '#6366F1', to: '#4F46E5', stroke: '#4338CA' },   // indigo
];

// ─── Characters ─────────────────────────────────────────────────────
// Each renders white-on-gradient artwork inside a -18..18 / -20..22 viewBox

const w = (opacity: number) => `rgba(255,255,255,${opacity})`;

function Watcher(): ReactNode {
  return (
    <g>
      <path d={`M5 -10 A10 10 0 1 0 5 12 A7 7 0 1 1 5 -10`} fill={w(0.15)} stroke={w(0.6)} strokeWidth={0.6} />
      <ellipse cx={-1} cy={1} rx={5} ry={3.5} fill="none" stroke={w(0.8)} strokeWidth={0.7} />
      <circle cx={-1} cy={1} r={1.8} fill={w(0.9)} />
      <circle cx={-1} cy={1} r={0.8} fill={w(0.3)} />
      <circle cx={7} cy={-7} r={0.6} fill={w(0.7)} />
      <circle cx={9} cy={-2} r={0.4} fill={w(0.5)} />
      <circle cx={-8} cy={-8} r={0.5} fill={w(0.4)} />
    </g>
  );
}

function Oracle(): ReactNode {
  return (
    <g>
      <path d="M-7 12 Q-7 4 -4 0 Q-2 -4 0 -6 Q2 -4 4 0 Q7 4 7 12" fill={w(0.12)} stroke={w(0.5)} strokeWidth={0.6} strokeLinecap="round" />
      <circle cx={-2.5} cy={2} r={0.8} fill={w(0.7)} />
      <circle cx={2.5} cy={2} r={0.8} fill={w(0.7)} />
      <path d="M0 -3 L-1.5 -1 L0 1 L1.5 -1 Z" fill={w(0.9)} />
      <line x1={0} y1={-5} x2={0} y2={-8} stroke={w(0.4)} strokeWidth={0.4} />
      <line x1={-3} y1={-4} x2={-5} y2={-7} stroke={w(0.3)} strokeWidth={0.4} />
      <line x1={3} y1={-4} x2={5} y2={-7} stroke={w(0.3)} strokeWidth={0.4} />
      <line x1={-5} y1={-2} x2={-8} y2={-3} stroke={w(0.2)} strokeWidth={0.3} />
      <line x1={5} y1={-2} x2={8} y2={-3} stroke={w(0.2)} strokeWidth={0.3} />
      <circle cx={-9} cy={-6} r={0.4} fill={w(0.5)} />
      <circle cx={8} cy={-7} r={0.5} fill={w(0.4)} />
    </g>
  );
}

function Serpent(): ReactNode {
  return (
    <g>
      <path d="M0 1 Q-6 -7 -8 -1 Q-10 5 -4 5 Q0 5 0 1 Q0 -3 4 -3 Q10 -3 8 3 Q6 9 0 1" fill="none" stroke={w(0.8)} strokeWidth={1} strokeLinecap="round" />
      <circle cx={-1} cy={0} r={0.6} fill={w(0.9)} />
      <circle cx={-7} cy={-2} r={0.5} fill={w(0.9)} />
      <circle cx={-4} cy={4.5} r={0.3} fill={w(0.3)} />
      <circle cx={4} cy={-3} r={0.3} fill={w(0.3)} />
      <circle cx={8} cy={1} r={0.3} fill={w(0.3)} />
      <circle cx={6} cy={-8} r={0.5} fill={w(0.4)} />
      <circle cx={-7} cy={-9} r={0.4} fill={w(0.3)} />
    </g>
  );
}

function Phoenix(): ReactNode {
  return (
    <g>
      <ellipse cx={0} cy={3} rx={3} ry={5} fill={w(0.2)} stroke={w(0.6)} strokeWidth={0.5} />
      <path d="M-3 2 Q-7 -2 -11 -5 Q-9 0 -7 2 Q-5 3 -3 3" fill={w(0.6)} stroke={w(0.7)} strokeWidth={0.4} />
      <path d="M3 2 Q7 -2 11 -5 Q9 0 7 2 Q5 3 3 3" fill={w(0.6)} stroke={w(0.7)} strokeWidth={0.4} />
      <circle cx={0} cy={-2} r={2} fill={w(0.7)} />
      <circle cx={-0.7} cy={-2.2} r={0.4} fill={w(0.3)} />
      <circle cx={0.7} cy={-2.2} r={0.4} fill={w(0.3)} />
      <path d="M-2 -4 Q-1.5 -7 -1 -5 Q0 -9 1 -5 Q1.5 -7 2 -4" fill={w(0.8)} />
      <path d="M-1 8 Q-2 11 -3 10" stroke={w(0.4)} strokeWidth={0.5} fill="none" strokeLinecap="round" />
      <path d="M0 8 Q0 12 0 11" stroke={w(0.5)} strokeWidth={0.5} fill="none" strokeLinecap="round" />
      <path d="M1 8 Q2 11 3 10" stroke={w(0.4)} strokeWidth={0.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Archer(): ReactNode {
  return (
    <g>
      <path d="M-4 -9 Q-10 0 -4 9" fill="none" stroke={w(0.8)} strokeWidth={1} strokeLinecap="round" />
      <line x1={-4} y1={-9} x2={-4} y2={9} stroke={w(0.5)} strokeWidth={0.5} />
      <line x1={-4} y1={0} x2={10} y2={0} stroke={w(0.85)} strokeWidth={0.8} strokeLinecap="round" />
      <path d="M10 0 L7 -2 L7 2 Z" fill={w(0.9)} />
      <path d="M-3 0 L-5 -1.5 M-3 0 L-5 1.5" stroke={w(0.5)} strokeWidth={0.4} />
      <circle cx={5} cy={-6} r={0.6} fill={w(0.7)} />
      <circle cx={8} cy={-4} r={0.4} fill={w(0.5)} />
      <circle cx={3} cy={-8} r={0.5} fill={w(0.5)} />
      <line x1={5} y1={-6} x2={8} y2={-4} stroke={w(0.2)} strokeWidth={0.3} />
      <line x1={5} y1={-6} x2={3} y2={-8} stroke={w(0.2)} strokeWidth={0.3} />
    </g>
  );
}

function Kraken(): ReactNode {
  return (
    <g>
      <ellipse cx={0} cy={-3} rx={5} ry={6} fill={w(0.15)} stroke={w(0.6)} strokeWidth={0.6} />
      <circle cx={-2} cy={-4} r={1} fill={w(0.85)} />
      <circle cx={2} cy={-4} r={1} fill={w(0.85)} />
      <circle cx={-2} cy={-4} r={0.4} fill={w(0.3)} />
      <circle cx={2} cy={-4} r={0.4} fill={w(0.3)} />
      <path d="M-4 2 Q-8 6 -10 4 Q-9 7 -6 5" fill="none" stroke={w(0.6)} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M-2 3 Q-4 9 -6 8 Q-4 10 -2 7" fill="none" stroke={w(0.6)} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M2 3 Q4 9 6 8 Q4 10 2 7" fill="none" stroke={w(0.6)} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M4 2 Q8 6 10 4 Q9 7 6 5" fill="none" stroke={w(0.6)} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M0 4 Q0 9 1 8" fill="none" stroke={w(0.5)} strokeWidth={0.6} strokeLinecap="round" />
      <circle cx={8} cy={-8} r={0.5} fill={w(0.3)} />
      <circle cx={6} cy={-10} r={0.3} fill={w(0.25)} />
    </g>
  );
}

function Sentinel(): ReactNode {
  return (
    <g>
      {/* Tower */}
      <rect x={-3} y={-2} width={6} height={12} rx={0.5} fill={w(0.2)} stroke={w(0.6)} strokeWidth={0.5} />
      <rect x={-4.5} y={-4} width={9} height={3} rx={0.5} fill={w(0.25)} stroke={w(0.6)} strokeWidth={0.5} />
      {/* Battlement */}
      <rect x={-5} y={-6} width={2.5} height={2.5} fill={w(0.5)} />
      <rect x={-1.2} y={-6} width={2.5} height={2.5} fill={w(0.5)} />
      <rect x={2.5} y={-6} width={2.5} height={2.5} fill={w(0.5)} />
      {/* Beacon light */}
      <circle cx={0} cy={-8} r={1.5} fill={w(0.9)} />
      <circle cx={0} cy={-8} r={3} fill={w(0.15)} />
      {/* Light rays */}
      <line x1={0} y1={-11} x2={0} y2={-14} stroke={w(0.4)} strokeWidth={0.4} />
      <line x1={-3} y1={-10} x2={-5} y2={-12} stroke={w(0.3)} strokeWidth={0.4} />
      <line x1={3} y1={-10} x2={5} y2={-12} stroke={w(0.3)} strokeWidth={0.4} />
      {/* Window */}
      <rect x={-1} y={2} width={2} height={3} rx={1} fill={w(0.6)} />
    </g>
  );
}

function Sphinx(): ReactNode {
  return (
    <g>
      {/* Body — seated cat-like form */}
      <path d="M-6 10 Q-6 4 -4 2 L-2 0 L0 -2 L2 0 L4 2 Q6 4 6 10" fill={w(0.12)} stroke={w(0.5)} strokeWidth={0.6} />
      {/* Paws */}
      <path d="M-6 10 L-8 10 L-8 8" stroke={w(0.4)} strokeWidth={0.5} strokeLinecap="round" fill="none" />
      <path d="M6 10 L8 10 L8 8" stroke={w(0.4)} strokeWidth={0.5} strokeLinecap="round" fill="none" />
      {/* Head — geometric */}
      <path d="M-4 -2 L0 -8 L4 -2 Z" fill={w(0.25)} stroke={w(0.7)} strokeWidth={0.5} />
      {/* Eyes */}
      <line x1={-2} y1={-4} x2={-1} y2={-4} stroke={w(0.9)} strokeWidth={0.7} strokeLinecap="round" />
      <line x1={1} y1={-4} x2={2} y2={-4} stroke={w(0.9)} strokeWidth={0.7} strokeLinecap="round" />
      {/* Third eye dot */}
      <circle cx={0} cy={-5.5} r={0.5} fill={w(0.8)} />
      {/* Stars */}
      <circle cx={-8} cy={-8} r={0.5} fill={w(0.4)} />
      <circle cx={8} cy={-6} r={0.4} fill={w(0.35)} />
      <circle cx={-6} cy={-12} r={0.4} fill={w(0.3)} />
    </g>
  );
}

function Stag(): ReactNode {
  return (
    <g>
      {/* Head */}
      <ellipse cx={0} cy={2} rx={4} ry={5} fill={w(0.15)} stroke={w(0.6)} strokeWidth={0.5} />
      {/* Eyes */}
      <circle cx={-1.5} cy={1} r={0.6} fill={w(0.8)} />
      <circle cx={1.5} cy={1} r={0.6} fill={w(0.8)} />
      {/* Nose */}
      <ellipse cx={0} cy={4} rx={1} ry={0.6} fill={w(0.5)} />
      {/* Left antler */}
      <path d="M-3 -2 L-5 -8 M-5 -8 L-7 -10 M-5 -8 L-3 -11" stroke={w(0.7)} strokeWidth={0.7} strokeLinecap="round" fill="none" />
      <path d="M-4 -5 L-7 -6" stroke={w(0.6)} strokeWidth={0.6} strokeLinecap="round" fill="none" />
      {/* Right antler */}
      <path d="M3 -2 L5 -8 M5 -8 L7 -10 M5 -8 L3 -11" stroke={w(0.7)} strokeWidth={0.7} strokeLinecap="round" fill="none" />
      <path d="M4 -5 L7 -6" stroke={w(0.6)} strokeWidth={0.6} strokeLinecap="round" fill="none" />
      {/* Stars at antler tips */}
      <circle cx={-7} cy={-10} r={0.5} fill={w(0.7)} />
      <circle cx={7} cy={-10} r={0.5} fill={w(0.7)} />
      <circle cx={-3} cy={-11} r={0.4} fill={w(0.5)} />
      <circle cx={3} cy={-11} r={0.4} fill={w(0.5)} />
    </g>
  );
}

function Raven(): ReactNode {
  return (
    <g>
      {/* Body */}
      <path d="M-2 10 Q-4 6 -3 2 Q-2 -1 0 -2 Q2 -1 3 2 Q4 6 2 10" fill={w(0.2)} stroke={w(0.6)} strokeWidth={0.5} />
      {/* Head */}
      <circle cx={0} cy={-4} r={3} fill={w(0.25)} stroke={w(0.6)} strokeWidth={0.5} />
      {/* Eye */}
      <circle cx={-0.5} cy={-4.5} r={0.7} fill={w(0.9)} />
      <circle cx={-0.5} cy={-4.5} r={0.3} fill={w(0.3)} />
      {/* Beak */}
      <path d="M2 -3.5 L5 -2.5 L2 -2" fill={w(0.7)} stroke={w(0.6)} strokeWidth={0.3} />
      {/* Wing — left, folded */}
      <path d="M-3 2 Q-8 0 -10 4 Q-8 6 -4 5" fill={w(0.15)} stroke={w(0.5)} strokeWidth={0.5} />
      {/* Wing — right, spread */}
      <path d="M3 2 Q8 -2 11 -4 Q9 1 7 3 Q5 5 3 4" fill={w(0.15)} stroke={w(0.5)} strokeWidth={0.5} />
      {/* Moon */}
      <path d="M-8 -10 A3 3 0 1 0 -8 -4 A2 2 0 1 1 -8 -10" fill={w(0.5)} />
      {/* Stars */}
      <circle cx={6} cy={-8} r={0.5} fill={w(0.5)} />
      <circle cx={9} cy={-6} r={0.3} fill={w(0.35)} />
    </g>
  );
}

function Wolf(): ReactNode {
  return (
    <g>
      {/* Head silhouette — howling upward */}
      <path d="M-5 8 Q-6 4 -5 0 Q-4 -3 -2 -4 L-1 -8 L0 -4 L1 -8 L2 -4 Q4 -3 5 0 Q6 4 5 8" fill={w(0.15)} stroke={w(0.6)} strokeWidth={0.6} />
      {/* Snout pointing up */}
      <path d="M-2 -4 Q0 -6 2 -4 L1 -10 Q0 -12 -1 -10 Z" fill={w(0.25)} stroke={w(0.6)} strokeWidth={0.4} />
      {/* Eye */}
      <circle cx={-2} cy={-1} r={0.7} fill={w(0.85)} />
      <circle cx={2} cy={-1} r={0.7} fill={w(0.85)} />
      {/* Mouth open — howling */}
      <path d="M-1 -8 Q0 -7 1 -8" stroke={w(0.5)} strokeWidth={0.4} fill="none" />
      {/* Moon behind */}
      <circle cx={7} cy={-10} r={4} fill={w(0.08)} stroke={w(0.3)} strokeWidth={0.4} />
      {/* Stars */}
      <circle cx={-8} cy={-10} r={0.5} fill={w(0.6)} />
      <circle cx={-6} cy={-13} r={0.4} fill={w(0.4)} />
      <circle cx={10} cy={-5} r={0.3} fill={w(0.35)} />
    </g>
  );
}

function Compass(): ReactNode {
  return (
    <g>
      {/* Outer ring */}
      <circle cx={0} cy={1} r={10} fill="none" stroke={w(0.4)} strokeWidth={0.5} />
      <circle cx={0} cy={1} r={7.5} fill="none" stroke={w(0.2)} strokeWidth={0.3} />
      {/* Cardinal points */}
      <line x1={0} y1={-9} x2={0} y2={-6} stroke={w(0.6)} strokeWidth={0.5} strokeLinecap="round" />
      <line x1={0} y1={8} x2={0} y2={11} stroke={w(0.4)} strokeWidth={0.5} strokeLinecap="round" />
      <line x1={-10} y1={1} x2={-7} y2={1} stroke={w(0.4)} strokeWidth={0.5} strokeLinecap="round" />
      <line x1={7} y1={1} x2={10} y2={1} stroke={w(0.4)} strokeWidth={0.5} strokeLinecap="round" />
      {/* North pointer — compass rose */}
      <path d="M0 -5 L-2 1 L0 -1 L2 1 Z" fill={w(0.85)} />
      {/* South pointer */}
      <path d="M0 7 L-2 1 L0 3 L2 1 Z" fill={w(0.3)} />
      {/* Center */}
      <circle cx={0} cy={1} r={1} fill={w(0.9)} />
      {/* Star at north */}
      <circle cx={0} cy={-12} r={0.8} fill={w(0.7)} />
    </g>
  );
}

// ─── Character registry ─────────────────────────────────────────────
const CHARACTERS: (() => ReactNode)[] = [
  Watcher, Oracle, Serpent, Phoenix, Archer, Kraken,
  Sentinel, Sphinx, Stag, Raven, Wolf, Compass,
];

// ─── Hash utility ───────────────────────────────────────────────────
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Component ──────────────────────────────────────────────────────
interface AgentCrestProps {
  id: string;
  size?: number;
}

export function AgentCrest({ id, size = 32 }: AgentCrestProps) {
  const h = hashId(id);
  const character = CHARACTERS[h % CHARACTERS.length];
  const palette = PALETTES[(h >>> 4) % PALETTES.length];
  const gradId = `cg-${id.slice(-8)}`;
  const height = Math.round(size * (42 / 36));

  return (
    <svg
      width={size}
      height={height}
      viewBox="-18 -20 36 42"
      className="shrink-0"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
      </defs>
      {/* Shield */}
      <path
        d="M0 -20 L18 -12 L18 8 L0 22 L-18 8 L-18 -12 Z"
        fill={`url(#${gradId})`}
        stroke={palette.stroke}
        strokeWidth={0.6}
      />
      {/* Inner border */}
      <path
        d="M0 -16 L15 -9 L15 6 L0 18 L-15 6 L-15 -9 Z"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={0.3}
      />
      {/* Character */}
      {character()}
    </svg>
  );
}
