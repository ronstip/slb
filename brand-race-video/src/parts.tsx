// Shared primitives, ported 1:1 from
// Marketing/checkpoints/wc-brand-leaderboard-v1/parts.jsx → TSX for Remotion.
import React from 'react';
import { Img, staticFile } from 'remotion';
import { C } from './theme';
import { F } from './fonts';
import { WC_LOGOS } from './logos';
import type { Brand } from './checkpoints';

export type MoveKind = 'up' | 'down' | 'same' | 'new';

export const Eyebrow: React.FC<{
  children: React.ReactNode;
  color?: string;
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, color, size = 12, style = {} }) => (
  <span
    style={{
      fontFamily: F.mono,
      fontSize: size,
      fontWeight: 500,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: color || C.muted,
      ...style,
    }}
  >
    {children}
  </span>
);

// Scolto corner mark
export const Mark: React.FC<{ size?: number; dot?: string; stroke?: string }> = ({
  size = 34,
  dot = C.orange,
  stroke = C.ink,
}) => {
  const sw = Math.max(3, size / 22);
  const W = 64;
  const ARM = 14;
  return (
    <svg
      viewBox={`-1 -1 ${W + 2} ${W + 2}`}
      width={size}
      height={size}
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    >
      <path d={`M0 ${ARM} V0 H${ARM}`} />
      <path d={`M${W - ARM} 0 H${W} V${ARM}`} />
      <path d={`M${W} ${W - ARM} V${W} H${W - ARM}`} />
      <path d={`M${ARM} ${W} H0 V${W - ARM}`} />
      <circle cx={W / 2} cy={W / 2} r="7" fill={dot} stroke="none" />
    </svg>
  );
};

// Brand tile — tinted glyph, else logo image, else monogram
export const BrandTile: React.FC<{ brand: Brand; size?: number; radius?: number }> = ({
  brand,
  size = 52,
  radius,
}) => {
  const r = radius != null ? radius : Math.round(size * 0.26);
  const chip: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: r,
    background: '#FFFFFF',
    border: `1px solid ${C.rule}`,
    boxSizing: 'border-box',
    display: 'inline-grid',
    placeItems: 'center',
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(26,23,20,0.12)',
  };
  const monogram = (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: r,
        background: brand.color,
        color: brand.fg,
        display: 'inline-grid',
        placeItems: 'center',
        boxShadow: '0 1px 2px rgba(26,23,20,0.20)',
        outline: '1px solid rgba(0,0,0,0.06)',
        fontFamily: F.serif,
        fontWeight: 600,
        fontSize: size * 0.5,
        lineHeight: 1,
        letterSpacing: '-0.02em',
      }}
    >
      {brand.mono}
    </span>
  );

  const path = brand.icon ? WC_LOGOS[brand.icon] : undefined;
  if (path) {
    return (
      <span style={chip}>
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          style={{ display: 'block' }}
        >
          <path d={path} fill={brand.color} />
        </svg>
      </span>
    );
  }
  if (brand.logo) {
    // Network logo (logo.dev). Render-safe: a flaky/slow fetch must never stall a
    // frame past the deadline (which would freeze mid-shift and abort the render),
    // so we give it a generous timeout + retries and fall back to the monogram
    // on error instead of throwing.
    return <LogoChip brand={brand} chip={chip} fallback={monogram} />;
  }
  return monogram;
};

const LogoChip: React.FC<{
  brand: Brand;
  chip: React.CSSProperties;
  fallback: React.ReactNode;
}> = ({ brand, chip, fallback }) => {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span style={chip}>
      <Img
        src={brand.logo!}
        delayRenderTimeoutInMilliseconds={60000}
        delayRenderRetries={3}
        onError={() => setFailed(true)}
        style={{ width: '70%', height: '70%', objectFit: 'contain', display: 'block' }}
      />
    </span>
  );
};

// Movement indicator (arrow / dash / flame)
export const Move: React.FC<{ move: MoveKind; size?: number }> = ({ move, size = 18 }) => {
  const s = size;
  if (move === 'same') {
    return (
      <svg width={s} height={s} viewBox="0 0 18 18" style={{ display: 'block' }}>
        <rect x="3" y="8" width="12" height="2.2" rx="1.1" fill={C.flat} />
      </svg>
    );
  }
  if (move === 'new') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" style={{ display: 'block' }}>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill={C.orange}
          d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.177 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152-.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 0 1 1.925-3.547 3.75 3.75 0 0 1 3.255 3.719Z"
        />
      </svg>
    );
  }
  const up = move === 'up';
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" style={{ display: 'block' }}>
      <path d={up ? 'M9 3 L15 12 L3 12 Z' : 'M9 15 L3 6 L15 6 Z'} fill={up ? C.up : C.down} />
    </svg>
  );
};

// Platform badges
const PLATFORMS: Record<string, { color: string; glyph: React.ReactNode }> = {
  instagram: {
    color:
      'radial-gradient(circle at 72% 108%, #FEDA77 0%, #F58529 40%, #DD2A7B 72%, #8134AF 94%, #515BD4 112%)',
    glyph: (
      <path
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"
        fill="#FFF"
      />
    ),
  },
  tiktok: {
    color: '#57534E',
    glyph: (
      <path
        d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.3 0 .59.05.86.12V9.01a6.32 6.32 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.98a8.21 8.21 0 004.77 1.52V7.05a4.83 4.83 0 01-1-.36z"
        fill="#FFF"
      />
    ),
  },
  x: {
    color: '#0F0F0F',
    glyph: (
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        fill="#FFF"
      />
    ),
  },
  youtube: {
    color: '#E03030',
    glyph: (
      <path
        d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
        fill="#FFF"
      />
    ),
  },
};

export const PlatformBadge: React.FC<{ id: string; size?: number }> = ({ id, size = 26 }) => {
  const p = PLATFORMS[id] || PLATFORMS.x;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: p.color,
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(15,12,8,0.18)',
        outline: '1px solid rgba(0,0,0,0.05)',
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} style={{ display: 'block' }}>
        {p.glyph}
      </svg>
    </span>
  );
};

export const Sources: React.FC<{ ids: string[]; size?: number; label?: string }> = ({
  ids,
  size = 26,
  label = 'measured across',
}) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    {label && (
      <Eyebrow size={10} style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Eyebrow>
    )}
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      {ids.map((id) => (
        <PlatformBadge key={id} id={id} size={size} />
      ))}
    </span>
  </span>
);

export const Legend: React.FC = () => {
  const item = (move: MoveKind, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Move move={move} size={14} />
      <Eyebrow size={10}>{label}</Eyebrow>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 18 }}>
      {item('up', 'climbing')}
      {item('down', 'slipping')}
      {item('same', 'held')}
      {item('new', 'Viral')}
    </span>
  );
};

// Official FIFA World Cup 26™ emblem (public/wc26.webp).
export const Emblem: React.FC<{ size?: number }> = ({ size = 150 }) => (
  <Img
    src={staticFile('wc26.webp')}
    style={{ height: size, width: 'auto', display: 'block' }}
  />
);

export const Dateline: React.FC<{ matchday: string; dateLabel: string; size?: number }> = ({
  matchday,
  dateLabel,
  size = 15.5,
}) => {
  const hair = (w: number) => (
    <span style={{ width: w, height: 1.5, background: C.rule, flexShrink: 0 }} />
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span
        style={{
          fontFamily: F.mono,
          fontSize: size,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: C.ink,
          whiteSpace: 'nowrap',
        }}
      >
        {matchday}
        <span style={{ color: C.orange, margin: '0 0.55em', fontWeight: 700 }}>·</span>
        {dateLabel}
      </span>
      {hair(56)}
    </div>
  );
};

export const ScopeStrip: React.FC<{
  scope: { event: string; segment: string };
  size?: number;
}> = ({ scope, size = 18 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
    <span
      style={{
        fontFamily: F.sans,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: '-0.01em',
        color: C.ink,
        whiteSpace: 'nowrap',
      }}
    >
      {scope.event}
      <span style={{ color: C.muted, margin: '0 0.6em', fontWeight: 400 }}>·</span>
      <span
        style={{ color: C.orangeDeep, borderBottom: `2px solid ${C.orange}`, paddingBottom: 2 }}
      >
        {scope.segment}
      </span>
    </span>
    <span style={{ flex: 1, height: 1, background: C.rule }} />
  </div>
);
