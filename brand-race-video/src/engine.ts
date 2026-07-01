import { CHECKPOINTS, type Brand } from './checkpoints';

export const FPS = 30;
export const VISIBLE = 12; // rows shown (boards slice top-12)

// Which day each checkpoint represents (pre / day4 / day7 / day11 / day12 / day14 / jul1).
const CHECKPOINT_DAYS = [1, 4, 7, 11, 12, 14, 21];
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
// The video is ONE continuous, constant-rate roll of the day counter from the
// first checkpoint day to the last. Real time on screen is proportional to
// ELAPSED DAYS, not to how big a reshuffle is — so every day ticks past at the
// same pace and the standings morph smoothly the whole way through, with no
// intermediate holds to make it feel stuck. A short intro hold eases in and a
// longer end hold lets the final board land.
const INTRO = 18; // brief hold on the opening standings before the roll begins (~0.6s)
const END_HOLD = 72; // freeze on the final standings (~2.4s)
const FRAMES_PER_DAY = 18; // constant day-roll pace (~0.6s per day)

const SPAN_DAYS = NUM_DAYS - FIRST_DAY; // total days the counter rolls across
const ROLL_FRAMES = SPAN_DAYS * FRAMES_PER_DAY;
export const TOTAL_FRAMES = INTRO + ROLL_FRAMES + END_HOLD;

// Continuous day for a frame: hold on day 1 through the intro, roll linearly,
// then rest on the final day for the end hold.
function dayAt(frame: number): number {
  if (frame <= INTRO) return FIRST_DAY;
  if (frame >= INTRO + ROLL_FRAMES) return NUM_DAYS;
  return FIRST_DAY + (frame - INTRO) / FRAMES_PER_DAY;
}

// Which checkpoint pair surrounds a given day, and how far between them (0..1).
// `cp` is the checkpoint being approached — it drives the live move/viral flags.
function locate(frame: number): { from: number; to: number; p: number; cp: number } {
  const day = dayAt(frame);
  for (let i = 0; i < CHECKPOINT_DAYS.length - 1; i++) {
    if (day <= CHECKPOINT_DAYS[i + 1]) {
      const span = CHECKPOINT_DAYS[i + 1] - CHECKPOINT_DAYS[i];
      const p = span ? (day - CHECKPOINT_DAYS[i]) / span : 1;
      return { from: i, to: i + 1, p, cp: i + 1 };
    }
  }
  const last = CHECKPOINT_DAYS.length - 1;
  return { from: last, to: last, p: 1, cp: last };
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
  const { from, to, p, cp } = locate(frame);
  const day = dayAt(frame);

  // Linear rank per brand (constant speed) between the two checkpoint orderings.
  const lin = new Map<string, number>();
  for (const name of ALL_BRANDS) lin.set(name, lerp(rankOf(from, name), rankOf(to, name), p));

  const frames = ALL_BRANDS.map((name) => {
    const l = lin.get(name)!;
    // Contiguous display position = soft count of brands whose linear rank is above.
    let rank = 0;
    for (const other of ALL_BRANDS) {
      if (other === name) continue;
      rank += smoothstep((l - lin.get(other)! + SWAP_W) / (2 * SWAP_W));
    }
    const sov = lerp(sovOf(from, name), sovOf(to, name), p);
    return { brand: meta.get(name)!, sov, rank, opacity: opacityFor(rank) };
  });
  return { day, cpIndex: cp, frames };
}

/** Max sov among currently-visible brands (per-frame axis, like the static boards). */
export function maxSovAt(frames: BrandFrame[]): number {
  return Math.max(0.1, ...frames.filter((f) => f.opacity > 0.05).map((f) => f.sov));
}
