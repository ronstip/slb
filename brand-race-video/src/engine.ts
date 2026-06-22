import { CHECKPOINTS, type Brand, type Checkpoint } from './checkpoints';

export const FPS = 30;
export const VISIBLE = 12; // rows shown (boards slice top-12)

// ── Timeline: a smooth day counter 1 → 11 ───────────────────────────────────
// The four data checkpoints sit on specific days; everything between them is
// interpolated, so the board glides forward one day at a time (no jump from
// "Days 1–4" to "Days 1–7").
export const NUM_DAYS = 11;
export const FIRST_DAY = 1; // Day 1 = Thu 11 Jun 2026 (pre-tournament snapshot)
const INTRO = 15; // settle on day 1
const FRAMES_PER_DAY = 30; // 1s per day → steady tick
const END_HOLD = 66; // freeze on the final standings
export const TOTAL_FRAMES = INTRO + (NUM_DAYS - 1) * FRAMES_PER_DAY + END_HOLD;

// Which day each checkpoint represents (pre / day4 / day7 / day11).
const CHECKPOINT_DAYS = [1, 4, 7, 11];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Continuous day [1..11] for a frame. */
export function dayAt(frame: number): number {
  if (frame <= INTRO) return FIRST_DAY;
  const f = frame - INTRO;
  return Math.min(NUM_DAYS, FIRST_DAY + f / FRAMES_PER_DAY);
}

/** Map a continuous day to a continuous checkpoint position [0..3]. */
export function dayToKp(day: number): number {
  for (let i = 0; i < CHECKPOINT_DAYS.length - 1; i++) {
    const d0 = CHECKPOINT_DAYS[i];
    const d1 = CHECKPOINT_DAYS[i + 1];
    if (day <= d1) return i + Math.max(0, (day - d0) / (d1 - d0));
  }
  return CHECKPOINT_DAYS.length - 1;
}

// Per-checkpoint sov lookups + a union of brand metadata.
const meta = new Map<string, Brand>();
const sovByCp: Map<string, number>[] = [];
for (const cp of CHECKPOINTS) {
  const sovMap = new Map<string, number>();
  for (const b of cp.brands) {
    sovMap.set(b.name, b.sov);
    if (!meta.has(b.name)) meta.set(b.name, b);
  }
  sovByCp.push(sovMap);
}
export const ALL_BRANDS = Array.from(meta.keys());

/** Interpolated sov for every brand at a continuous checkpoint position. */
function sovAtKp(kp: number): Map<string, number> {
  const a = Math.floor(kp);
  const b = Math.min(CHECKPOINTS.length - 1, a + 1);
  const t = kp - a;
  const m = new Map<string, number>();
  for (const name of ALL_BRANDS) {
    m.set(name, lerp(sovByCp[a].get(name) ?? 0, sovByCp[b].get(name) ?? 0, t));
  }
  return m;
}

export interface BrandFrame {
  brand: Brand;
  sov: number;
  rank: number; // smooth row position
  visible: boolean;
}

// Soft-rank window (in sov %). Two brands closer than ~W in share are mid-swap;
// their row positions cross smoothly instead of snapping. Bigger = smoother
// slides but more overlap; smaller = crisper but steppier.
const W = 0.4;
const smoothstep = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * Brand values + smooth row positions at a continuous day [1..11].
 * Position = soft count of brands ranked above. Because every brand's rank is
 * the same continuous sum, the rows stay contiguous at all times (no gaps) and
 * glide through rank swaps one neighbour at a time.
 */
export function brandsAt(day: number): BrandFrame[] {
  const sov = sovAtKp(dayToKp(day));
  return ALL_BRANDS.map((name) => {
    const s = sov.get(name) ?? 0;
    let rank = 0;
    for (const other of ALL_BRANDS) {
      if (other === name) continue;
      const so = sov.get(other) ?? 0;
      rank += smoothstep((so - s + W) / (2 * W)); // ~1 if other clearly above, ~0 below
    }
    return { brand: meta.get(name)!, sov: s, rank, visible: s > 0.05 && rank < VISIBLE - 0.5 };
  });
}

/** Max sov among currently-visible brands (per-frame axis, like the static boards). */
export function maxSovAt(frames: BrandFrame[]): number {
  return Math.max(0.1, ...frames.filter((f) => f.visible).map((f) => f.sov));
}

/** The checkpoint whose header/scope/mover-note should show right now. */
export function nearestCheckpoint(kp: number): Checkpoint {
  return CHECKPOINTS[Math.round(kp)];
}
