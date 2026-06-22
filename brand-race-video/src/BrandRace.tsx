// Direction C — "The Race", ported from board-race.jsx and animated as a smooth
// day-by-day counter (Day 1 → Day 11) across the four real checkpoints.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import { C } from './theme';
import { F } from './fonts';
import {
  Mark,
  BrandTile,
  Move,
  Sources,
  Legend,
  Emblem,
  Dateline,
  ScopeStrip,
  type MoveKind,
} from './parts';
import { platforms, footer, url, type Brand } from './checkpoints';
import { dayAt, dayToKp, brandsAt, maxSovAt, nearestCheckpoint, ALL_BRANDS, VISIBLE } from './engine';

const W = 1080;
const H = 1350;
const PAD_X = 60;
const BARS_TOP = 312; // y where the bar list begins
const BARS_H = 936; // total height of the 12-row list (rows get the freed space)
const ROW_H = BARS_H / VISIBLE;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Day 1 = Thu 11 Jun 2026 → weekday anchor index 4 (Thu).
function datelineFor(day: number): { matchday: string; dateLabel: string } {
  const dow = DOW[(4 + (day - 1)) % 7];
  return { matchday: `Day ${day}`, dateLabel: `${dow} ${10 + day} Jun 2026` };
}

const SCOPE = { event: 'Opening run', segment: 'All brands' } as const;

export const BrandRace: React.FC = () => {
  const frame = useCurrentFrame();
  const day = dayAt(frame);
  const dayInt = Math.round(day);
  const kp = dayToKp(day);
  const frames = brandsAt(day);
  const max = maxSovAt(frames);
  const cp = nearestCheckpoint(kp); // drives only the live move/viral arrows
  const { matchday, dateLabel } = datelineFor(dayInt);

  const live = new Map<string, Brand>();
  for (const b of cp.brands) live.set(b.name, b);

  const intro = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: C.cream, fontFamily: F.sans, color: C.ink }}>
      <div
        style={{
          position: 'absolute',
          width: W,
          height: H,
          boxSizing: 'border-box',
          padding: '54px 60px 44px',
          overflow: 'hidden',
          opacity: intro,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(120% 55% at 18% 4%, rgba(217,119,87,0.13) 0%, rgba(217,119,87,0.04) 42%, transparent 72%)',
            pointerEvents: 'none',
          }}
        />

        {/* WC26 emblem */}
        <div style={{ position: 'absolute', top: 30, right: 56, zIndex: 3 }}>
          <Emblem size={150} />
        </div>

        {/* top utility row */}
        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Mark size={38} />
            <span
              style={{
                fontFamily: F.serif,
                fontStyle: 'italic',
                fontWeight: 400,
                fontSize: 32,
                letterSpacing: '-0.02em',
                color: C.ink,
              }}
            >
              Scolto
            </span>
          </div>
        </div>

        {/* title band — day counter + title */}
        <div style={{ marginTop: 30, position: 'relative' }}>
          <Dateline matchday={matchday} dateLabel={dateLabel} size={16} />
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 500,
              fontSize: 78,
              lineHeight: 0.96,
              letterSpacing: '-0.04em',
              color: C.ink,
              marginTop: 14,
            }}
          >
            Brand exposure
          </div>
        </div>

        {/* scope strip + platform sources */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 18, position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ScopeStrip scope={SCOPE} size={21} />
          </div>
          <Sources ids={platforms} size={26} />
        </div>

        {/* bars (animated, absolutely positioned by rank) */}
        <div style={{ position: 'absolute', left: PAD_X, right: PAD_X, top: BARS_TOP, height: BARS_H }}>
          {ALL_BRANDS.map((name) => {
            const bf = frames.find((f) => f.brand.name === name)!;
            const b = bf.brand;
            const leader = Math.round(bf.rank) === 0 && bf.visible;
            const pct = (bf.sov / max) * 100;
            const fill = leader
              ? `linear-gradient(90deg, ${C.orangeDeep}, ${C.orange})`
              : `linear-gradient(90deg, ${C.ink}, ${C.slate})`;
            const lb = live.get(name);
            const move: MoveKind = (lb?.move ?? b.move) as MoveKind;
            const viral = lb?.viral ?? b.viral;
            return (
              <div
                key={name}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: ROW_H,
                  transform: `translateY(${bf.rank * ROW_H}px)`,
                  opacity: bf.visible ? 1 : 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                }}
              >
                <span
                  style={{
                    width: 38,
                    textAlign: 'center',
                    fontFamily: F.serif,
                    fontWeight: leader ? 500 : 400,
                    fontSize: leader ? 34 : 28,
                    color: leader ? C.orangeDeep : C.slate,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >
                  {Math.round(bf.rank) + 1}
                </span>
                <BrandTile brand={b} size={48} />
                <span
                  style={{
                    width: 214,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: F.sans,
                      fontWeight: 600,
                      fontSize: 24,
                      letterSpacing: '-0.015em',
                      color: C.ink,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                  >
                    {b.name}
                  </span>
                  {viral && <Move move="new" size={19} />}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 42,
                      background: 'rgba(26,23,20,0.05)',
                      borderRadius: 999,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: pct + '%',
                        background: fill,
                        borderRadius: 999,
                        boxShadow: leader ? '0 4px 14px -6px rgba(217,119,87,0.6)' : 'none',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 100,
                      textAlign: 'right',
                      flexShrink: 0,
                      fontFamily: F.serif,
                      fontWeight: leader ? 500 : 400,
                      fontSize: leader ? 38 : 31,
                      color: leader ? C.orangeDeep : C.ink,
                      letterSpacing: '-0.03em',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {bf.sov.toFixed(1)}
                    <span style={{ fontSize: 17, color: leader ? C.orangeDeep : C.muted }}>%</span>
                  </span>
                  <span style={{ width: 24, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <Move move={move} size={20} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div
          style={{
            position: 'absolute',
            left: PAD_X,
            right: PAD_X,
            bottom: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 16,
            borderTop: `1px solid ${C.rule}`,
          }}
        >
          <Legend />
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 12,
              color: C.muted,
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
            }}
          >
            {footer} · <span style={{ fontWeight: 600, color: C.orangeDeep }}>{url}</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
