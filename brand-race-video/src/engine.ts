import { CHECKPOINTS, type Brand } from './checkpoints';

export const FPS = 30;
export const VISIBLE = 12; // rows shown (boards slice top-12)

// Which day each checkpoint represents (pre / day4 / day7 / day11 / day12).
const CHECKPOINT_DAYS = [1, 4, 7, 11, 12];
export const FIRST_DAY = CHECKPOINT_DAYS[0]; // Day 1 = Thu 11 Jun 2026
export const NUM_DAYS = CHECKPOINT_DAYS[CHECKPOINT_DAYS.length - 1];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Per-checkpoint lookups: sov, integer rank, and a union of brand metadata ──
const meta = new Map<string, Brand>();
const sovByCp: Map<string, number>[] = [];
const rankByCp: Map<string, number>[] = [];
for (const cp of CHECKPOINTS) {
  const sovMap = new Map<string, number>();
  const sorted = [...cp.brands].sort((a, b) => b.sov - a.sov);
  const rankMap = new Map<string, number>();
  sorted.forEach((b, i) => rankMap.set(b.name, i)); // 0-indexed rank
  for (const b of cp.brands) {
    sovMap.set(b.name, b.sov);
    if (!meta.has(b.name)) meta.set(b.name, b);
  }
  sovByCp.push(sovMap);
  rankByCp.push(rankMap);
}
export const ALL_BRANDS = Array.from(meta.keys());

const OFF = VISIBLE; // off-board rank: brands absent from a checkpoint park just below the list
const rankOf = (i: number, name: string) => rankByCp[i].get(name) ?? OFF;
const sovOf = (i: number, name: string) => sovByCp[i].get(name) ?? 0;

// ── Timeline ─────────────────────────────────────────────────────────────────
// Built from segments: an intro hold on day 1, then for each pair of checkpoints
// a MOVE (rows glide to the next standings) followed by a HOLD (dwell on them).
// A MOVE's length is proportional to the largest rank change in it, so the
// fastest-moving row travels at ONE constant rate across the whole video — a big
// reshuffle simply gets more time instead of zipping. Rank is interpolated
// LINEARLY, so rows navigate at constant speed (no easing accel mid-flight).
const INTRO = 20; // hold on the opening standings (~0.7s)
const HOLD = 24; // dwell at each intermediate checkpoint (~0.8s)
const END_HOLD = 72; // freeze on the final standings (~2.4s)
const FRAMES_PER_ROW = 17; // time for the fastest row to advance one position (~0.57s) — the speed cap

const maxMove = (i: number): number => {
  let m = 0;
  for (const n of ALL_BRANDS) {
    const d = Math.abs(rankOf(i + 1, n) - rankOf(i, n));
    if (d > m) m = d;
  }
  return m;
};

interface Seg {
  kind: 'hold' | 'move';
  cp: number; // checkpoint shown (hold) or being approached (move)
  from: number;
  to: number;
  len: number;
}
const segs: Seg[] = [{ kind: 'hold', cp: 0, from: 0, to: 0, len: INTRO }];
for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
  const len = Math.max(1, maxMove(i)) * FRAMES_PER_ROW;
  segs.push({ kind: 'move', cp: i + 1, from: i, to: i + 1, len });
  const last = i === CHECKPOINTS.length - 2;
  segs.push({ kind: 'hold', cp: i + 1, from: i + 1, to: i + 1, len: last ? END_HOLD : HOLD });
}
export const TOTAL_FRAMES = segs.reduce((a, s) => a + s.len, 0);

function locate(frame: number): { s: Seg; p: number } {
  let f = frame;
  for (const s of segs) {
    if (f < s.len) return { s, p: s.len ? f / s.len : 1 };
    f -= s.len;
  }
  const last = segs[segs.length - 1];
  return { s: last, p: 1 };
}

export interface BrandFrame {
  brand: Brand;
  sov: number;
  rank: number; // smooth row position (0-indexed)
  opacity: number; // fades in/out as a brand crosses the bottom edge of the list
}

// Opacity fades a brand in/out over the last ~0.7 rows of the visible window so
// entries slide in and drop-outs slide off cleanly.
const opacityFor = (rank: number) => Math.max(0, Math.min(1, (VISIBLE - rank) / 0.7));

// Soft-count crossing window (in rank units). A row's display position is the
// soft count of brands ranked above it; using a soft count keeps the rows
// strictly contiguous (no gaps, no pile-ups) while two rows swap smoothly when
// their linear ranks cross. ≥ the 1.0 spacing of settled ranks, so steady
// standings still resolve to clean integers.
const SWAP_W = 0.45;
const smoothstep = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

export interface RaceState {
  day: number; // continuous day for the header counter
  cpIndex: number; // checkpoint whose move/viral flags are live
  frames: BrandFrame[];
}

export function stateAt(frame: number): RaceState {
  const { s, p } = locate(frame);
  const day = s.kind === 'move' ? lerp(CHECKPOINT_DAYS[s.from], CHECKPOINT_DAYS[s.to], p) : CHECKPOINT_DAYS[s.cp];

  // Linear rank per brand (constant speed) between the two checkpoint orderings.
  const lin = new Map<string, number>();
  for (const name of ALL_BRANDS) lin.set(name, lerp(rankOf(s.from, name), rankOf(s.to, name), p));

  const frames = ALL_BRANDS.map((name) => {
    const l = lin.get(name)!;
    // Contiguous display position = soft count of brands whose linear rank is above.
    let rank = 0;
    for (const other of ALL_BRANDS) {
      if (other === name) continue;
      rank += smoothstep((l - lin.get(other)! + SWAP_W) / (2 * SWAP_W));
    }
    const sov = lerp(sovOf(s.from, name), sovOf(s.to, name), p);
    return { brand: meta.get(name)!, sov, rank, opacity: opacityFor(rank) };
  });
  return { day, cpIndex: s.cp, frames };
}

/** Max sov among currently-visible brands (per-frame axis, like the static boards). */
export function maxSovAt(frames: BrandFrame[]): number {
  return Math.max(0.1, ...frames.filter((f) => f.opacity > 0.05).map((f) => f.sov));
}
